// Usage: npm run agent -- "How much is 100 dollars in reais?"

import { runAgent } from "./agent";
import { loadTrace, printTrace } from "./trace-printer";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run agent -- "your question"');
  process.exit(1);
}

const result = await runAgent(question);

console.log(`\n${result.answer}\n`);
console.log(
  `steps=${result.steps}  tools=[${result.toolCalls.map((c) => c.name).join(", ")}]  ` +
    `tokens=${result.inputTokens}/${result.outputTokens}  cost=$${result.costUsd.toFixed(4)}  ` +
    `latency=${result.latencyMs}ms  stop=${result.stopReason}`,
);
printTrace(loadTrace(result.traceId));
