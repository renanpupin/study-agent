// Versioned system prompts. Switching versions and running the eval again is
// the most basic "experiment": PROMPT_VERSION=v2 npm run eval

const PROMPTS: Record<string, string> = {
  v1: `You are an assistant that helps with weather, currency conversion and calculations.
Use the available tools when you need them.`,

  v2: `You are an assistant that helps with weather, currency conversion and calculations.

Rules:
- Never do math in your head: every calculation, however simple, goes through the calculator tool.
- Use only the data returned by the tools. If a tool fails or does not have the data, say clearly that you do not have that information, without estimating.
- For questions outside these topics, answer briefly without using tools.
- Be direct: one or two sentences, with the final number highlighted.`,
};

export function getSystemPrompt(version: string): string {
  const prompt = PROMPTS[version];
  if (!prompt) throw new Error(`Unknown prompt: ${version}. Options: ${Object.keys(PROMPTS).join(", ")}`);
  return prompt;
}
