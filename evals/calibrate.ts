// Calibração do judge: ele concorda com um humano?
//
// Um judge só serve como métrica se concordar com o julgamento humano.
// Aqui rodamos o judge em exemplos que já rotulamos à mão (calibration.jsonl)
// e medimos a concordância. Se ela for baixa, ajuste o prompt ou o critério
// do judge antes de confiar nos números do eval.
//
// Uso: npm run judge:calibrate

import type { ToolCall } from "../src/agent";
import { GROUNDEDNESS_CRITERION, judge } from "./judge";
import { mark, pct, readJsonl } from "./io";

interface CalibrationItem {
  id: string;
  question: string;
  tool_calls: ToolCall[];
  answer: string;
  /** Texto do critério, ou "grounded" para usar o critério fixo de alucinação. */
  criterion: string;
  human_pass: boolean;
}

const items = readJsonl<CalibrationItem>("evals/calibration.jsonl");
console.log(`Calibrando o judge em ${items.length} exemplos rotulados por humano...\n`);

const rows = await Promise.all(
  items.map(async (item) => {
    const verdict = await judge("calibration", {
      question: item.question,
      toolCalls: item.tool_calls,
      answer: item.answer,
      criterion: item.criterion === "grounded" ? GROUNDEDNESS_CRITERION : item.criterion,
    });
    return { item, verdict };
  }),
);

let tp = 0, tn = 0, fp = 0, fn = 0;
for (const { item, verdict } of rows) {
  if (verdict.pass && item.human_pass) tp++;
  else if (!verdict.pass && !item.human_pass) tn++;
  else if (verdict.pass && !item.human_pass) fp++;
  else fn++;
}

console.table(
  rows.map(({ item, verdict }) => ({
    exemplo: item.id,
    humano: mark(item.human_pass),
    judge: mark(verdict.pass),
    concorda: item.human_pass === verdict.pass ? "sim" : "NÃO",
  })),
);

const n = rows.length;
const agreement = (tp + tn) / n;
// Cohen's kappa: concordância descontando a que aconteceria por acaso.
const chance = ((tp + fp) / n) * ((tp + fn) / n) + ((tn + fn) / n) * ((tn + fp) / n);
const kappa = chance === 1 ? 1 : (agreement - chance) / (1 - chance);

console.log(`\nConcordância: ${pct(agreement)}   Cohen's kappa: ${kappa.toFixed(2)}`);
console.log(`Falso positivo (judge aprovou, humano reprovou): ${fp}   Falso negativo: ${fn}`);
console.log("Referência: kappa > 0.8 é ótimo; < 0.6 indica que o judge precisa de ajuste.");

for (const { item, verdict } of rows.filter(({ item, verdict }) => item.human_pass !== verdict.pass)) {
  console.log(`\n[${item.id}] humano=${mark(item.human_pass)} judge=${mark(verdict.pass)}\n  ${verdict.reasoning}`);
}
