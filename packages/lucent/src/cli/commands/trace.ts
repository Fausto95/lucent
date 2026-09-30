import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";
import type { BuildRecord } from "../build-graph.ts";
import { type ChromeTrace, formatMs, mergeTraces, summarize } from "../trace.ts";

const HOW =
  "run the app or its tests with LUCENT_TRACE=<file>.json and pass --runtime <file>; on a device, LUCENT_TRACE=platform (iOS, Instruments' os_signpost) or `adb shell setprop debug.lucent.trace 1` (Android, Perfetto's atrace)";

/**
 * `lucent trace`: one Chrome trace of the last build's steps and the runtime
 * traces given, in .lucent/trace.json (or --out), and how long each cause took.
 */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;

  const recordFile = path.join(root, ".lucent", "build-record.json");
  const record: BuildRecord | undefined = fs.existsSync(recordFile)
    ? JSON.parse(fs.readFileSync(recordFile, "utf8"))
    : undefined;

  const runtimeFiles =
    typeof flags.runtime === "string"
      ? flags.runtime.split(",").map((f) => path.resolve(root, f.trim()))
      : [];

  if (!record && !runtimeFiles.length) {
    out.error(
      `${t.error(t.symbols.fail)} no build record in ${path.join(root, ".lucent")} and no --runtime trace: build first, or ${HOW}`,
    );
    return 1;
  }

  const runtimes: { name: string; trace: ChromeTrace }[] = [];
  for (const file of runtimeFiles) {
    if (!fs.existsSync(file)) {
      out.error(`${t.error(t.symbols.fail)} no runtime trace at ${file}: ${HOW}`);
      return 1;
    }

    runtimes.push({ name: path.basename(file), trace: JSON.parse(fs.readFileSync(file, "utf8")) });
  }

  const merged = mergeTraces(record, runtimes);
  const target =
    typeof flags.out === "string"
      ? path.resolve(root, flags.out)
      : path.join(root, ".lucent", "trace.json");

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(merged)}\n`);

  const shown = path.relative(root, target) || target;
  out.print(
    `${t.success(t.symbols.ok)} wrote ${shown}  ${t.dim("open it in ui.perfetto.dev or chrome://tracing")}`,
  );

  if (record) {
    const steps = Object.entries(record.timings)
      .sort(([a], [b]) => (record.startedAt?.[a] ?? 0) - (record.startedAt?.[b] ?? 0))
      .map(([id, ms]) => `${id} ${formatMs(ms)}`);

    out.print(`  ${"build".padEnd(16)} ${steps.join(" · ") || t.dim("nothing timed")}`);
  }

  for (const { name, trace } of runtimes) {
    const causes = summarize(trace).categories.map(
      (c) =>
        `${c.category} ${formatMs(c.ms)}${c.bytes ? ` (${(c.bytes / 1e6).toFixed(1)} MB)` : ""}`,
    );
    const dropped = Number(trace.otherData?.dropped ?? 0);

    out.print(
      `  ${name.padEnd(16)} ${causes.join(" · ") || t.dim("no spans")}${dropped ? t.dim(`  (${dropped} events dropped)`) : ""}`,
    );
  }

  return 0;
}
