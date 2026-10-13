// The agent: a manual tool-use loop.
//
//   1. send the conversation + tools to the model
//   2. if it asks for tools (stop_reason "tool_use"), run them and send the results back
//   3. repeat until it answers without asking for tools (or MAX_STEPS is reached)
//
// We write the loop by hand to see every piece. In production, the SDK's Tool
// Runner (client.beta.messages.toolRunner) runs this loop for you.

import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_EFFORT, AGENT_MODEL, MAX_STEPS, PROMPT_VERSION } from "./config";
import { createMessage, messageCost } from "./llm";
import { getSystemPrompt } from "./prompts";
import { executeTool, toolDefinitions } from "./tools";
import { setAttributes, withSpan } from "./tracing";

export interface ToolCall {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
}

export interface AgentResult {
  traceId: string;
  answer: string;
  toolCalls: ToolCall[];
  steps: number;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export async function runAgent(question: string): Promise<AgentResult> {
  return withSpan(
    "agent.run",
    "agent",
    async (span) => {
      const startedAt = Date.now();
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
      const toolCalls: ToolCall[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let cost = 0;
      let answer = "";
      let stopReason = "max_steps";
      let steps = 0;

      while (steps < MAX_STEPS) {
        steps++;
        const response = await createMessage(
          {
            model: AGENT_MODEL,
            max_tokens: 16000,
            system: getSystemPrompt(PROMPT_VERSION),
            tools: toolDefinitions,
            output_config: { effort: AGENT_EFFORT },
            messages,
          },
          `llm.step_${steps}`,
        );
        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;
        cost += messageCost(response);

        // Always send back the whole content (thinking blocks included), not
        // just the text: the model needs to see its own history intact.
        messages.push({ role: "assistant", content: response.content });

        const toolUses = response.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
        );

        if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
          // End of the loop: end_turn (normal), refusal, max_tokens...
          stopReason = response.stop_reason ?? "unknown";
          answer = response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();
          break;
        }

        // The model may ask for several tools at once: we run all of them and
        // send ALL the results back in a single "user" message.
        const results = await Promise.all(toolUses.map(runToolTraced));
        toolCalls.push(...results.map((r) => r.call));
        messages.push({ role: "user", content: results.map((r) => r.block) });
      }

      const result: AgentResult = {
        traceId: span.traceId,
        answer,
        toolCalls,
        steps,
        stopReason,
        inputTokens,
        outputTokens,
        costUsd: cost,
        latencyMs: Date.now() - startedAt,
      };
      setAttributes(span, {
        answer,
        steps,
        stop_reason: stopReason,
        tools_called: toolCalls.map((c) => c.name),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
      });
      return result;
    },
    { question, model: AGENT_MODEL, prompt_version: PROMPT_VERSION, effort: AGENT_EFFORT },
  );
}

async function runToolTraced(toolUse: Anthropic.Beta.BetaToolUseBlock) {
  return withSpan(
    `tool.${toolUse.name}`,
    "tool",
    async (span) => {
      let output: string;
      let isError = false;
      try {
        output = executeTool(toolUse.name, toolUse.input);
      } catch (err) {
        // A tool error does NOT bring the agent down: it becomes a tool_result
        // with is_error, and the model decides what to do (retry, tell the user...).
        output = err instanceof Error ? err.message : String(err);
        isError = true;
      }
      setAttributes(span, { output, is_error: isError });
      const block: Anthropic.Beta.BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: output,
        is_error: isError,
      };
      return { block, call: { name: toolUse.name, input: toolUse.input, output, isError } };
    },
    { input: toolUse.input },
  );
}
