/**
 * Traces in the Chrome trace event format (Perfetto's UI, chrome://tracing):
 * the build's steps from its record, and runtime traces as the runtime
 * writes them (LUCENT_TRACE=<file>.json), merged with a process each, and
 * summed by cause (entry, lock, queue, run, native, completion, compute,
 * copy, alloc).
 */
import type { BuildRecord } from "./build-graph.ts";

export interface ChromeEvent {
  name: string;
  cat?: string;
  ph: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  id?: number;
  s?: string;
  bp?: string;
  args?: Record<string, unknown>;
}

export interface ChromeTrace {
  traceEvents: ChromeEvent[];
  displayTimeUnit?: string;
  otherData?: Record<string, unknown>;
}

/** The order causes are reported in. */
const CATEGORIES = [
  "entry",
  "lock",
  "queue",
  "run",
  "native",
  "effect",
  "completion",
  "compute",
  "copy",
  "alloc",
  "build",
] as const;

const BUILD_PID = 1;

/** The build's steps: a span for each timed one, a mark for the others. */
export function buildEvents(record: BuildRecord): ChromeEvent[] {
  const startedAt = record.startedAt ?? {};

  return record.nodes.map((node): ChromeEvent => {
    const args = {
      kind: node.kind,
      status: node.status,
      ...(node.detail ? { detail: node.detail } : {}),
    };
    const ms = record.timings[node.id];

    if (ms === undefined || startedAt[node.id] === undefined) {
      return { name: node.id, cat: "build", ph: "i", s: "p", ts: 0, pid: BUILD_PID, tid: 1, args };
    }

    return {
      name: node.id,
      cat: "build",
      ph: "X",
      ts: startedAt[node.id]! * 1000,
      dur: ms * 1000,
      pid: BUILD_PID,
      tid: 1,
      args,
    };
  });
}

const processName = (pid: number, name: string): ChromeEvent => ({
  name: "process_name",
  ph: "M",
  pid,
  args: { name },
});

/** One trace: the build (if recorded) and each runtime trace, a process each. */
export function mergeTraces(
  record: BuildRecord | undefined,
  runtimes: { name: string; trace: ChromeTrace }[],
): ChromeTrace {
  const events: ChromeEvent[] = [];

  if (record) events.push(processName(BUILD_PID, "lucent build"), ...buildEvents(record));

  runtimes.forEach(({ name, trace }, i) => {
    const pid = BUILD_PID + 1 + i;

    events.push(processName(pid, name));
    for (const e of trace.traceEvents) events.push({ ...e, pid });
  });

  return { traceEvents: events, displayTimeUnit: "ms" };
}

export interface CauseTotal {
  category: string;
  ms: number;
  count: number;
  bytes?: number;
}

/** Time spent in each cause (spans only), and the bytes copies moved. */
export function summarize(trace: ChromeTrace): { categories: CauseTotal[] } {
  const totals = new Map<string, CauseTotal>();

  for (const e of trace.traceEvents) {
    if (e.ph !== "X" || !e.cat) continue;

    const total = totals.get(e.cat) ?? { category: e.cat, ms: 0, count: 0 };
    total.ms += (e.dur ?? 0) / 1000;
    total.count++;

    const bytes = e.cat === "copy" ? Number(e.args?.value ?? 0) : 0;
    if (bytes > 0) total.bytes = (total.bytes ?? 0) + bytes;

    totals.set(e.cat, total);
  }

  const order = (c: string) => {
    const i = CATEGORIES.indexOf(c as (typeof CATEGORIES)[number]);
    return i < 0 ? CATEGORIES.length : i;
  };

  const categories = [...totals.values()]
    .sort((a, b) => order(a.category) - order(b.category))
    .map((t) => ({ ...t, ms: Math.round(t.ms * 1000) / 1000 }));

  return { categories };
}

/** `12 ms`, `0.06 ms`, `4.2 s`. */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;

  return `${Number(ms.toPrecision(3))} ms`;
}
