// Configuração central. Tudo pode ser sobrescrito por variável de ambiente
// para rodar "experimentos" (ex.: PROMPT_VERSION=v2 npm run eval).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";
export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-opus-5-5";

// Effort controla o quanto o modelo "pensa" (e quantos tokens gasta).
// Tarefas simples como as deste projeto vão bem com "low".
export const AGENT_EFFORT = (process.env.AGENT_EFFORT ?? "low") as Effort;
export const JUDGE_EFFORT = (process.env.JUDGE_EFFORT ?? "medium") as Effort;

// Qual system prompt do agente usar (ver src/prompts.ts).
export const PROMPT_VERSION = process.env.PROMPT_VERSION ?? "v1";

// Guarda de segurança: o loop do agente nunca passa disso.
export const MAX_STEPS = 8;

// Preço em USD por 1M de tokens. Usado para calcular custo por chamada.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
