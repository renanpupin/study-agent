// A minimal, hand-written tracer, to understand the concept.
//
// Trace = one complete run (e.g. one question to the agent).
// Span  = one step inside it (LLM call, tool execution, judge...).
// Spans form a tree through parentId. This is exactly the OpenTelemetry model,
// which is what Langfuse, Phoenix, Datadog etc. consume in production.

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

// AsyncLocalStorage keeps the "current span" across awaits, so a span created
// inside another one automatically becomes its child (like in OTel).
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
    // The root span finished: the trace is complete, so we save it to disk.
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
