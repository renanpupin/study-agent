import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

export const RESULTS_DIR = "results";

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export function saveResult(name: string, data: unknown): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = `${RESULTS_DIR}/${name}.json`;
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

/** Os N arquivos de resultado mais recentes (os nomes começam com timestamp). */
export function latestResults(n: number): string[] {
  return readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-n)
    .map((f) => `${RESULTS_DIR}/${f}`);
}

export const mark = (pass: boolean) => (pass ? "✓" : "✗");
export const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
