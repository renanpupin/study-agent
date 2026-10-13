// Compara duas execuções do eval (ex.: prompt v1 vs v2).
//
// Uso: npm run eval:compare                    (as duas mais recentes)
//      npm run eval:compare -- results/a.json results/b.json

import { readFileSync } from "node:fs";
import type { CaseResult } from "./run";
import { latestResults, mark, pct } from "./io";

interface RunFile {
  config: Record<string, string>;
  summary: Record<string, number>;
  cases: CaseResult[];
}

const [pathA, pathB] = process.argv.length >= 4 ? process.argv.slice(2, 4) : latestResults(2);
if (!pathA || !pathB) {
  console.error("Preciso de dois resultados. Rode `npm run eval` duas vezes (ex.: com PROMPT_VERSION diferente).");
  process.exit(1);
}
const a = JSON.parse(readFileSync(pathA, "utf8")) as RunFile;
const b = JSON.parse(readFileSync(pathB, "utf8")) as RunFile;

console.log(`A: ${pathA}  ${JSON.stringify(a.config)}`);
console.log(`B: ${pathB}  ${JSON.stringify(b.config)}\n`);

const format = (key: string, v: number) =>
  key.endsWith("_rate") ? pct(v) : key.endsWith("usd") ? `$${v.toFixed(4)}` : String(Math.round(v * 100) / 100);

console.table(
  Object.keys(a.summary).map((key) => {
    const va = a.summary[key]!;
    const vb = b.summary[key] ?? NaN;
    const delta = vb - va;
    return { métrica: key, A: format(key, va), B: format(key, vb), "Δ": `${delta >= 0 ? "+" : ""}${format(key, delta)}` };
  }),
);

// O que mais importa: quais casos mudaram de resultado.
const changed = b.cases.filter((cb) => {
  const ca = a.cases.find((c) => c.id === cb.id);
  return ca && ca.pass !== cb.pass;
});
if (changed.length === 0) {
  console.log("Nenhum caso mudou de PASS/FAIL.");
} else {
  console.log("Casos que mudaram:");
  for (const cb of changed) {
    const ca = a.cases.find((c) => c.id === cb.id)!;
    const tag = cb.pass ? "MELHOROU" : "REGREDIU";
    console.log(`  ${tag.padEnd(9)} ${cb.id}  A ${mark(ca.pass)} → B ${mark(cb.pass)}`);
    for (const check of cb.checks.filter((c) => !c.pass)) console.log(`            ✗ ${check.name}: ${check.detail}`);
  }
}
