// Avaliações DETERMINÍSTICAS: código puro, sem LLM.
// São baratas, rápidas e 100% reproduzíveis. Use sempre que der; deixe o
// LLM-as-a-judge só para o que código não consegue verificar.

import type { AgentResult } from "../src/agent";

export interface EvalCase {
  id: string;
  input: string;
  expected_tools: string[];
  /** Cada item precisa aparecer na resposta. "a|b" = basta um dos dois. */
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

/** O agente chamou exatamente o conjunto de tools esperado? (ordem e repetições não importam) */
function checkToolSelection(testCase: EvalCase, result: AgentResult): CheckResult {
  const called = [...new Set(result.toolCalls.map((c) => c.name))].sort();
  const expected = [...new Set(testCase.expected_tools)].sort();
  return {
    name: "tools",
    pass: JSON.stringify(called) === JSON.stringify(expected),
    detail: `esperado [${expected.join(", ")}], chamou [${called.join(", ")}]`,
  };
}

/** A resposta contém os valores esperados? */
function checkAnswerContains(testCase: EvalCase, result: AgentResult): CheckResult {
  const answer = normalizeNumbers(result.answer).toLowerCase();
  const missing = testCase.must_contain.filter(
    (item) => !item.split("|").some((alt) => answer.includes(alt.toLowerCase())),
  );
  return {
    name: "contains",
    pass: missing.length === 0,
    detail: missing.length ? `faltou: ${missing.join(", ")}` : "ok",
  };
}

/** Não ficou dando voltas? Mais passos = mais custo e latência. */
function checkSteps(testCase: EvalCase, result: AgentResult): CheckResult {
  const max = testCase.max_steps ?? 4;
  return { name: "steps", pass: result.steps <= max, detail: `${result.steps}/${max}` };
}

/** Terminou normalmente (sem recusa, sem estourar tokens ou passos)? */
function checkCompleted(result: AgentResult): CheckResult {
  return { name: "completed", pass: result.stopReason === "end_turn", detail: result.stopReason };
}

// "R$ 7.006.652" e "7 006 652" viram "7006652", para comparar com o esperado.
// Checks determinísticos quase sempre precisam de alguma normalização assim.
function normalizeNumbers(text: string): string {
  return text.replace(/(\d)[.,\s](?=\d{3}\b)/g, "$1");
}
