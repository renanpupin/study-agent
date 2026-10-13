// Judge calibration: does it agree with a human?
//
// A judge is only useful as a metric if it agrees with human judgment.
// Here we run the judge on examples we already labeled by hand
// (calibration.jsonl) and measure the agreement. If it is low, adjust the
// judge's prompt or criterion before trusting the eval numbers.
//
// Usage: npm run judge:calibrate

import type { ToolCall } from "../src/agent";
import { GROUNDEDNESS_CRITERION, judge } from "./judge";
import { mark, pct, readJsonl } from "./io";

interface CalibrationItem {
  id: string;
  question: string;
  tool_calls: ToolCall[];
  answer: string;
  /** Criterion text, or "grounded" to use the fixed hallucination criterion. */
  criterion: string;
  human_pass: boolean;
}

const items = readJsonl<CalibrationItem>("evals/calibration.jsonl");
console.log(`Calibrating the judge on ${items.length} human-labeled examples...\n`);

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
    example: item.id,
    human: mark(item.human_pass),
    judge: mark(verdict.pass),
    agrees: item.human_pass === verdict.pass ? "yes" : "NO",
  })),
);

const n = rows.length;
const agreement = (tp + tn) / n;
// Cohen's kappa: agreement discounting what would happen by chance.
const chance = ((tp + fp) / n) * ((tp + fn) / n) + ((tn + fn) / n) * ((tn + fp) / n);
const kappa = chance === 1 ? 1 : (agreement - chance) / (1 - chance);

console.log(`\nAgreement: ${pct(agreement)}   Cohen's kappa: ${kappa.toFixed(2)}`);
console.log(`False positives (judge passed, human failed): ${fp}   False negatives: ${fn}`);
console.log("Reference: kappa > 0.8 is great; < 0.6 means the judge needs adjusting.");

for (const { item, verdict } of rows.filter(({ item, verdict }) => item.human_pass !== verdict.pass)) {
  console.log(`\n[${item.id}] human=${mark(item.human_pass)} judge=${mark(verdict.pass)}\n  ${verdict.reasoning}`);
}
