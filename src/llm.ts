// Single entry point for calling Claude. Every call becomes an "llm" span in
// the trace, with model, tokens, cost and stop_reason. Centralizing it here is
// what guarantees that no call is "invisible" to observability.

import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "./config";
import { setAttributes, withSpan } from "./tracing";

// Reads ANTHROPIC_API_KEY from the environment (or from .env, via the package.json scripts).
export const client = new Anthropic();

// If the main model refuses the request (stop_reason "refusal"), the API
// automatically retries the call on another model. "default" picks the
// fallback based on the refusal category, so there is no model list to maintain.
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

type CreateParams = Omit<
  Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  "betas" | "fallbacks"
>;

export function createMessage(params: CreateParams, spanName = "llm.call") {
  return traced(spanName, () => client.beta.messages.create({ ...params, ...FALLBACK }));
}

export function parseMessage<P extends CreateParams>(params: P, spanName = "llm.parse") {
  return traced(spanName, () => client.beta.messages.parse({ ...params, ...FALLBACK }));
}

export function messageCost(message: Anthropic.Beta.BetaMessage): number {
  // message.model is the model that actually answered (it may be the fallback).
  return costUsd(message.model, message.usage.input_tokens, message.usage.output_tokens);
}

async function traced<M extends Anthropic.Beta.BetaMessage>(
  spanName: string,
  request: () => Promise<M>,
): Promise<M> {
  return withSpan(spanName, "llm", async (span) => {
    const message = await request();
    setAttributes(span, {
      model: message.model,
      stop_reason: message.stop_reason,
      // Only set on refusals: the category and an explanation of the reason.
      ...(message.stop_details && { stop_details: message.stop_details }),
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cost_usd: messageCost(message),
      output: summarizeContent(message.content),
    });
    return message;
  });
}

function summarizeContent(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_use") return `→ ${block.name}(${JSON.stringify(block.input)})`;
      return `[${block.type}]`;
    })
    .join(" ");
}
