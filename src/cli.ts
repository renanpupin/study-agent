// Uso: npm run agent -- "Quanto é 100 dólares em reais?"

import { runAgent } from "./agent";
import { loadTrace, printTrace } from "./trace-printer";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Uso: npm run agent -- "sua pergunta"');
  process.exit(1);
}

const result = await runAgent(question);

console.log(`\n${result.answer}\n`);
console.log(
  `steps=${result.steps}  tools=[${result.toolCalls.map((c) => c.name).join(", ")}]  ` +
    `tokens=${result.inputTokens}/${result.outputTokens}  custo=$${result.costUsd.toFixed(4)}  ` +
    `latência=${result.latencyMs}ms  stop=${result.stopReason}`,
);
printTrace(loadTrace(result.traceId));
