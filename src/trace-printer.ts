import { readdirSync, readFileSync, statSync } from "node:fs";
import { TRACES_DIR, type Span } from "./tracing";

export function loadTrace(traceId?: string): Span[] {
  const file = traceId ? `${traceId}.json` : latestTraceFile();
  return JSON.parse(readFileSync(`${TRACES_DIR}/${file}`, "utf8")) as Span[];
}

function latestTraceFile(): string {
  const files = readdirSync(TRACES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error("Nenhum trace encontrado. Rode `npm run agent` primeiro.");
  return files.sort((a, b) => statSync(`${TRACES_DIR}/${b}`).mtimeMs - statSync(`${TRACES_DIR}/${a}`).mtimeMs)[0]!;
}

/** Imprime os spans como árvore, no estilo da "waterfall" de uma ferramenta de observabilidade. */
export function printTrace(spans: Span[]): void {
  const root = spans.find((s) => s.parentId === null);
  if (!root) return;
  console.log(`\ntrace ${root.traceId}`);
  printSpan(root, spans, "");
}

function printSpan(span: Span, all: Span[], indent: string): void {
  const status = span.status === "error" ? " ✗" : "";
  console.log(`${indent}├─ [${span.kind}] ${span.name}  ${span.durationMs ?? "?"}ms${status}  ${describe(span)}`);
  for (const child of all.filter((s) => s.parentId === span.spanId)) {
    printSpan(child, all, indent + "│  ");
  }
}

function describe(span: Span): string {
  const a = span.attributes;
  switch (span.kind) {
    case "llm":
      return `${a.model} in=${a.input_tokens} out=${a.output_tokens} $${Number(a.cost_usd).toFixed(4)} stop=${a.stop_reason}  ${truncate(String(a.output ?? ""))}`;
    case "tool":
      return `${JSON.stringify(a.input)} → ${a.is_error ? "ERRO " : ""}${truncate(String(a.output ?? ""))}`;
    case "agent":
      return `steps=${a.steps} $${Number(a.cost_usd ?? 0).toFixed(4)} "${truncate(String(a.question ?? ""))}"`;
    case "eval":
      return a.pass === undefined ? "" : a.pass ? "PASS" : `FAIL  ${truncate(String(a.reasoning ?? ""))}`;
  }
}

function truncate(text: string, max = 90): string {
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
