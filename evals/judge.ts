// LLM-as-a-judge: one model evaluates another model's answer against a criterion.
//
// Best practices applied here:
//  - BINARY verdict (pass/fail), much more consistent than a 1-10 score
//  - one criterion per call, written objectively
//  - a short justification next to the verdict, so a human can audit it later.
//    The model already "thinks" internally (adaptive thinking); do NOT ask it
//    to write its step-by-step reasoning in the output: that is treated as an
//    attempt to extract the internal reasoning and the API refuses it
//    (stop_reason "refusal", category "reasoning_extraction").
//  - structured output (JSON validated by Zod), no regex over free text
//  - the judge sees the tool calls, so it can detect hallucinations
//  - calibrate against human labels (see evals/calibrate.ts)

import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ToolCall } from "../src/agent";
import { JUDGE_EFFORT, JUDGE_MODEL } from "../src/config";
import { messageCost, parseMessage } from "../src/llm";
import { setAttributes, withSpan } from "../src/tracing";

const Verdict = z.object({
  reasoning: z.string().describe("Justification for the verdict in one or two sentences"),
  pass: z.boolean(),
});

export interface JudgeInput {
  question: string;
  toolCalls: ToolCall[];
  answer: string;
  criterion: string;
}

export interface JudgeResult {
  pass: boolean;
  reasoning: string;
  costUsd: number;
}

// Fixed criterion, used in every case: did the answer make something up?
export const GROUNDEDNESS_CRITERION = `Every concrete piece of data in the answer (temperatures, weather conditions, amounts, rates, calculation results) appears in the tool results or is correctly derived from them. Widely known general knowledge (e.g. country capitals) is acceptable. Fail if there is any number or fact that is made up, estimated, or contradicts the tool results.`;

const SYSTEM = `You are a strict evaluator of an AI agent's answers.
Evaluate ONLY the requested criterion, ignoring the style and length of the answer unless the criterion mentions them.
When in doubt, fail it. In reasoning, justify the verdict in one or two sentences.`;

export async function judge(name: string, input: JudgeInput): Promise<JudgeResult> {
  return withSpan(`judge.${name}`, "eval", async (span) => {
    const response = await parseMessage(
      {
        model: JUDGE_MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: JUDGE_EFFORT, format: betaZodOutputFormat(Verdict) },
        messages: [{ role: "user", content: buildPrompt(input) }],
      },
      "llm.judge",
    );
    const verdict = response.parsed_output;
    if (!verdict) {
      const category = response.stop_details?.category ? `, category=${response.stop_details.category}` : "";
      throw new Error(`Judge did not return a valid verdict (stop_reason=${response.stop_reason}${category})`);
    }
    setAttributes(span, { criterion: input.criterion, pass: verdict.pass, reasoning: verdict.reasoning });
    return { ...verdict, costUsd: messageCost(response) };
  });
}

function buildPrompt({ question, toolCalls, answer, criterion }: JudgeInput): string {
  const calls = toolCalls.length
    ? toolCalls
        .map((c) => `- ${c.name}(${JSON.stringify(c.input)}) → ${c.isError ? "ERROR: " : ""}${c.output}`)
        .join("\n")
    : "(no tools were called)";
  return `<user_question>
${question}
</user_question>

<tool_calls>
${calls}
</tool_calls>

<agent_answer>
${answer}
</agent_answer>

<criterion>
${criterion}
</criterion>

Does the agent's answer meet the criterion?`;
}
