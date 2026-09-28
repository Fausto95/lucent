import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { BuildGraph } from "../src/cli/build-graph.ts";
import { buildEvents, type ChromeTrace, mergeTraces, summarize } from "../src/cli/trace.ts";
import { runLucent } from "./run-to-exit.ts";

function lucent(args: string[]) {
  const r = runLucent(args, { env: { ...process.env, NO_COLOR: "1" } });

  return { status: r.status, out: r.stdout + r.stderr };
}

/** A runtime trace as the runtime writes it (LUCENT_TRACE=<file>.json). */
function runtimeTrace(): ChromeTrace {
  const span = (name: string, cat: string, ts: number, dur: number, args = {}) => ({
    name,
    cat,
    ph: "X",
    ts,
    dur,
    pid: 1,
    tid: 3,
    args: { context: 2, ...args },
  });

  return {
    traceEvents: [
      span("measure", "entry", 100, 900, { id: 7, site: "/app/src/stats.lucent.ts:12" }),
      span("wait", "queue", 120, 400, { id: 7 }),
      span("run", "run", 520, 300, { id: 7 }),
      span("compute.wait", "compute", 600, 150, { id: 9, detail: "edges" }),
      span("transport.copy", "copy", 540, 60, { value: 8388608, count: 1 }),
      { name: "correlation", cat: "flow", ph: "s", id: 7, ts: 100, pid: 1, tid: 3 },
    ],
    displayTimeUnit: "ms",
    otherData: { dropped: 0 },
  };
}

describe("build phases in a trace", () => {
  it("records when each timed step started, apart from what it hashes", () => {
    const graph = new BuildGraph("build");

    graph.record("resolve", "resolve", "ok", { ms: 5 });
    graph.record("check", "check", "ok", { ms: 20 });
    graph.record("extract", "extract", "cached");

    const record = graph.toRecord({ kind: "none" });

    expect(Object.keys(record.startedAt).sort()).toEqual(["check", "resolve"]);
    expect(record.startedAt.resolve).toBeGreaterThanOrEqual(0);
    expect(record.nodes.find((n) => n.id === "check")).not.toHaveProperty("startedAt");
  });

  it("lays each step out as a span of the build process", () => {
    const graph = new BuildGraph("build");
    graph.record("check", "check", "ok", { ms: 20 });
    graph.record("generate", "generate", "ok", { ms: 7 });
    graph.record("extract", "extract", "cached");

    const record = graph.toRecord({ kind: "reload-js" });
    record.startedAt = { check: 0, generate: 20 };

    const events = buildEvents(record);

    expect(events).toEqual([
      expect.objectContaining({ name: "check", cat: "build", ph: "X", ts: 0, dur: 20000 }),
      expect.objectContaining({ name: "generate", cat: "build", ph: "X", ts: 20000, dur: 7000 }),
      expect.objectContaining({ name: "extract", cat: "build", ph: "i" }),
    ]);
    expect(events[0]!.args).toMatchObject({ kind: "check", status: "ok" });
  });
});

describe("merged traces", () => {
  it("keeps the build and each runtime trace in a process of its own", () => {
    const graph = new BuildGraph("build");
    graph.record("check", "check", "ok", { ms: 20 });

    const merged = mergeTraces(graph.toRecord({ kind: "none" }), [
      { name: "app", trace: runtimeTrace() },
    ]);

    const pids = new Set(merged.traceEvents.map((e) => e.pid));
    expect(pids.size).toBe(2);

    const names = merged.traceEvents.filter((e) => e.ph === "M").map((e) => e.args?.name);
    expect(names).toEqual(expect.arrayContaining(["lucent build", "app"]));
  });

  it("sums the time a trace spent in each cause", () => {
    const summary = summarize(runtimeTrace());

    expect(summary.categories).toEqual([
      { category: "entry", ms: 0.9, count: 1 },
      { category: "queue", ms: 0.4, count: 1 },
      { category: "run", ms: 0.3, count: 1 },
      { category: "compute", ms: 0.15, count: 1 },
      { category: "copy", ms: 0.06, count: 1, bytes: 8388608 },
    ]);
  });
});

describe("lucent trace", () => {
  it("writes the last build's phases and a runtime trace as one Chrome trace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-trace-"));
    fs.writeFileSync(
      path.join(root, "a.lucent.ts"),
      "export function one(): number { return 1; }\n",
    );

    expect(lucent(["build", "--platforms", "host", "--root", root]).status).toBe(0);

    const runtime = path.join(root, "app-trace.json");
    fs.writeFileSync(runtime, JSON.stringify(runtimeTrace()));

    const r = lucent(["trace", "--runtime", runtime, "--root", root]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/wrote \.lucent\/trace\.json/);
    expect(r.out).toMatch(/build +.*check/);
    expect(r.out).toMatch(/app-trace\.json +entry 0\.9 ms · queue 0\.4 ms/);
    expect(r.out).toMatch(/copy 0\.06 ms \(8\.4 MB\)/);

    const trace = JSON.parse(fs.readFileSync(path.join(root, ".lucent/trace.json"), "utf8"));
    expect(trace.traceEvents.some((e: { cat: string }) => e.cat === "build")).toBe(true);
    expect(trace.traceEvents.some((e: { cat: string }) => e.cat === "compute")).toBe(true);
  });

  it("says what to do when there is nothing to trace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-trace-"));

    const r = lucent(["trace", "--root", root]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no build record/);
    expect(r.out).toMatch(/LUCENT_TRACE/);
  });
});
