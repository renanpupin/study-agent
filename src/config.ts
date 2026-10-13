// Central configuration. Everything can be overridden through environment
// variables to run "experiments" (e.g. PROMPT_VERSION=v2 npm run eval).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";
export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-opus-5-5";

// Effort controls how much the model "thinks" (and how many tokens it spends).
// Simple tasks like the ones in this project work well with "low".
export const AGENT_EFFORT = (process.env.AGENT_EFFORT ?? "low") as Effort;
export const JUDGE_EFFORT = (process.env.JUDGE_EFFORT ?? "medium") as Effort;

// Which agent system prompt to use (see src/prompts.ts).
export const PROMPT_VERSION = process.env.PROMPT_VERSION ?? "v1";

// Safety guard: the agent loop never goes past this.
export const MAX_STEPS = 8;

// Price in USD per 1M tokens. Used to compute the cost of each call.
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
