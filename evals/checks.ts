// DETERMINISTIC evaluations: plain code, no LLM.
// They are cheap, fast and 100% reproducible. Use them whenever you can; keep
// LLM-as-a-judge only for what code cannot check.

import type { AgentResult } from "../src/agent";

export interface EvalCase {
  id: string;
  input: string;
  expected_tools: string[];
  /** Each item must appear in the answer. "a|b" = either one is enough. */
  must_contain: string[];
  rubric: string;
  max_steps?: number;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runChecks(testCase: EvalCase, result: AgentResult): CheckResult[] {
  return [
    checkToolSelection(testCase, result),
    checkAnswerContains(testCase, result),
    checkSteps(testCase, result),
    checkCompleted(result),
  ];
}

/** Did the agent call exactly the expected set of tools? (order and repetitions don't matter) */
function checkToolSelection(testCase: EvalCase, result: AgentResult): CheckResult {
  const called = [...new Set(result.toolCalls.map((c) => c.name))].sort();
  const expected = [...new Set(testCase.expected_tools)].sort();
  return {
    name: "tools",
    pass: JSON.stringify(called) === JSON.stringify(expected),
    detail: `expected [${expected.join(", ")}], called [${called.join(", ")}]`,
  };
}

/** Does the answer contain the expected values? */
function checkAnswerContains(testCase: EvalCase, result: AgentResult): CheckResult {
  const answer = normalizeNumbers(result.answer).toLowerCase();
  const missing = testCase.must_contain.filter(
    (item) => !item.split("|").some((alt) => answer.includes(alt.toLowerCase())),
  );
  return {
    name: "contains",
    pass: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(", ")}` : "ok",
  };
}

/** Did it avoid going in circles? More steps = more cost and latency. */
function checkSteps(testCase: EvalCase, result: AgentResult): CheckResult {
  const max = testCase.max_steps ?? 4;
  return { name: "steps", pass: result.steps <= max, detail: `${result.steps}/${max}` };
}

/** Did it finish normally (no refusal, no running out of tokens or steps)? */
function checkCompleted(result: AgentResult): CheckResult {
  return { name: "completed", pass: result.stopReason === "end_turn", detail: result.stopReason };
}

// "$7,006,652" and "7 006 652" become "7006652", to compare with the expected value.
// Deterministic checks almost always need some normalization like this.
function normalizeNumbers(text: string): string {
  return text.replace(/(\d)[.,\s](?=\d{3}\b)/g, "$1");
}
