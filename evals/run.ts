// Runs the agent over the whole dataset, evaluates each answer and saves the result.
//
// Usage: npm run eval
//        npm run eval -- --only weather-sp,simple-math
//        PROMPT_VERSION=v2 npm run eval        (an "experiment")

import { runAgent } from "../src/agent";
import { AGENT_EFFORT, AGENT_MODEL, JUDGE_MODEL, PROMPT_VERSION } from "../src/config";
import { withSpan, setAttributes } from "../src/tracing";
import { runChecks, type CheckResult, type EvalCase } from "./checks";
import { GROUNDEDNESS_CRITERION, judge, type JudgeInput, type JudgeResult } from "./judge";
import { mark, pct, readJsonl, saveResult } from "./io";

export interface CaseResult {
  id: string;
  input: string;
  answer: string;
  traceId: string;
  checks: CheckResult[];
  pass: boolean;
  steps: number;
  latencyMs: number;
  agentCostUsd: number;
  judgeCostUsd: number;
}

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? process.argv[onlyArg + 1]?.split(",") : undefined;
const dataset = readJsonl<EvalCase>("evals/dataset.jsonl").filter((c) => !only || only.includes(c.id));

console.log(`Running ${dataset.length} cases | agent=${AGENT_MODEL} (effort ${AGENT_EFFORT}) prompt=${PROMPT_VERSION} | judge=${JUDGE_MODEL}\n`);

const results: CaseResult[] = [];
for (const testCase of dataset) {
  process.stdout.write(`• ${testCase.id} ... `);
  const result = await evaluateCase(testCase);
  results.push(result);
  const failed = result.checks.filter((c) => !c.pass);
  console.log(result.pass ? "PASS" : `FAIL (${failed.map((c) => `${c.name}: ${c.detail}`).join(" | ")})`);
}

async function evaluateCase(testCase: EvalCase): Promise<CaseResult> {
  // One trace per case, containing the agent AND its evaluations.
  return withSpan(`eval_case.${testCase.id}`, "eval", async (span) => {
    const agent = await runAgent(testCase.input);
    const checks = runChecks(testCase, agent);

    const judgeInput = { question: testCase.input, toolCalls: agent.toolCalls, answer: agent.answer };
    const [correct, grounded] = await Promise.all([
      safeJudge("correct", { ...judgeInput, criterion: testCase.rubric }),
      safeJudge("grounded", { ...judgeInput, criterion: GROUNDEDNESS_CRITERION }),
    ]);
    checks.push(
      { name: "judge_correct", pass: correct.pass, detail: correct.reasoning },
      { name: "judge_grounded", pass: grounded.pass, detail: grounded.reasoning },
    );

    const pass = checks.every((c) => c.pass);
    setAttributes(span, { pass });
    return {
      id: testCase.id,
      input: testCase.input,
      answer: agent.answer,
      traceId: agent.traceId,
      checks,
      pass,
      steps: agent.steps,
      latencyMs: agent.latencyMs,
      agentCostUsd: agent.costUsd,
      judgeCostUsd: correct.costUsd + grounded.costUsd,
    };
  });
}

// A judge error (refusal, network failure...) does not bring the whole eval
// down: the check counts as a failure and the reason shows up in the detail.
async function safeJudge(name: string, input: JudgeInput): Promise<JudgeResult> {
  try {
    return await judge(name, input);
  } catch (err) {
    return { pass: false, reasoning: `[judge error] ${err instanceof Error ? err.message : err}`, costUsd: 0 };
  }
}

// ---- Per-case table ----
const checkNames = results[0]?.checks.map((c) => c.name) ?? [];
console.log();
console.table(
  results.map((r) => ({
    case: r.id,
    ...Object.fromEntries(r.checks.map((c) => [c.name, mark(c.pass)])),
    n_steps: r.steps,
    latency: `${(r.latencyMs / 1000).toFixed(1)}s`,
    cost: `$${r.agentCostUsd.toFixed(4)}`,
  })),
);

// ---- Aggregated metrics ----
const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
const percentile = (p: number) => latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)] ?? 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const summary = {
  cases: results.length,
  pass_rate: sum(results.map((r) => (r.pass ? 1 : 0))) / results.length,
  ...Object.fromEntries(
    checkNames.map((name) => [
      `${name}_rate`,
      sum(results.map((r) => (r.checks.find((c) => c.name === name)?.pass ? 1 : 0))) / results.length,
    ]),
  ),
  avg_steps: sum(results.map((r) => r.steps)) / results.length,
  latency_p50_ms: percentile(0.5),
  latency_p95_ms: percentile(0.95),
  agent_cost_usd: sum(results.map((r) => r.agentCostUsd)),
  judge_cost_usd: sum(results.map((r) => r.judgeCostUsd)),
};

console.log("\nSummary");
for (const [key, value] of Object.entries(summary)) {
  const shown = key.endsWith("_rate") ? pct(value) : key.endsWith("usd") ? `$${value.toFixed(4)}` : value;
  console.log(`  ${key.padEnd(22)} ${shown}`);
}

const runAt = new Date().toISOString();
const path = saveResult(`${runAt.replace(/[:.]/g, "-")}_${PROMPT_VERSION}`, {
  runAt,
  config: { agentModel: AGENT_MODEL, agentEffort: AGENT_EFFORT, promptVersion: PROMPT_VERSION, judgeModel: JUDGE_MODEL },
  summary,
  cases: results,
});
console.log(`\nResult saved to ${path}`);
console.log("See a case's trace with: npm run trace -- <traceId from the file>");
