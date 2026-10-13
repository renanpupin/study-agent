// Ponto único de chamada ao Claude. Toda chamada vira um span "llm" no trace,
// com modelo, tokens, custo e stop_reason. Centralizar aqui é o que garante
// que nenhuma chamada fica "invisível" para a observabilidade.

import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "./config";
import { setAttributes, withSpan } from "./tracing";

// Lê ANTHROPIC_API_KEY do ambiente (ou do .env, via scripts do package.json).
export const client = new Anthropic();

// Se o modelo principal recusar a requisição (stop_reason "refusal"), a API
// refaz a chamada automaticamente em outro modelo. "default" escolhe o
// fallback pela categoria da recusa, sem manter lista de modelos.
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
  // message.model é o modelo que de fato respondeu (pode ser o fallback).
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
