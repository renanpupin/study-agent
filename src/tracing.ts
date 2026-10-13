// Um tracer mínimo, escrito à mão, para entender o conceito.
//
// Trace = uma execução completa (ex.: uma pergunta ao agente).
// Span  = uma etapa dentro dela (chamada ao LLM, execução de tool, judge...).
// Spans formam uma árvore via parentId. É exatamente o modelo do OpenTelemetry,
// que é o que Langfuse, Phoenix, Datadog etc. consomem em produção.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

export type SpanKind = "agent" | "llm" | "tool" | "eval";

export interface Span {
  traceId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  startTime: number;
  durationMs?: number;
  status: "ok" | "error";
  attributes: Record<string, unknown>;
}

export const TRACES_DIR = "traces";

// AsyncLocalStorage guarda o "span atual" através de awaits, então um span
// criado dentro de outro vira filho dele automaticamente (como no OTel).
const currentSpan = new AsyncLocalStorage<Span>();
const spansByTrace = new Map<string, Span[]>();

export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  const parent = currentSpan.getStore();
  const span: Span = {
    traceId: parent?.traceId ?? randomUUID(),
    spanId: randomUUID(),
    parentId: parent?.spanId ?? null,
    name,
    kind,
    startTime: Date.now(),
    status: "ok",
    attributes: { ...attributes },
  };

  const spans = spansByTrace.get(span.traceId) ?? [];
  spans.push(span);
  spansByTrace.set(span.traceId, spans);

  try {
    return await currentSpan.run(span, () => fn(span));
  } catch (err) {
    span.status = "error";
    span.attributes.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    span.durationMs = Date.now() - span.startTime;
    // Span raiz terminou: o trace está completo, então salvamos em disco.
    if (span.parentId === null) flushTrace(span.traceId);
  }
}

export function setAttributes(span: Span, attributes: Record<string, unknown>): void {
  Object.assign(span.attributes, attributes);
}

function flushTrace(traceId: string): void {
  const spans = spansByTrace.get(traceId) ?? [];
  mkdirSync(TRACES_DIR, { recursive: true });
  writeFileSync(`${TRACES_DIR}/${traceId}.json`, JSON.stringify(spans, null, 2));
  spansByTrace.delete(traceId);
}
