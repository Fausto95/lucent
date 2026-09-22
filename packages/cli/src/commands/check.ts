import { analyzeFile, errorCount, loadConfig, structuredDiagnostics, warningCount } from "../analyze.ts";
import { colorizeDiagnostic } from "../diagnostics.ts";
import { count } from "../ui.ts";
import { elapsed, resolveFiles, watchLoop } from "./shared.ts";
import { defineCommand, type CommandContext } from "./types.ts";

export const checkCommand = defineCommand({
  name: "check",
  glyph: "check",
  summary: "Type-check Lucent files without generating anything",
  usage: "[options] [files…]",
  options: {
    watch: { type: "boolean", short: "w", description: "Re-check whenever a Lucent file or the config changes" },
  },
  examples: [
    { command: "lucent check", note: "Check every Lucent file in the project" },
    { command: "lucent check src/geo.lucent.ts", note: "Check one file" },
    { command: "lucent check --json", note: "Structured diagnostics for editors and CI" },
  ],
  async run(ctx, values, positionals) {
    const once = (): Promise<number> => checkOnce(ctx, positionals);
    const code = await once();
    return values.watch ? watchLoop(ctx, once) : code;
  },
});

async function checkOnce(ctx: CommandContext, positionals: readonly string[]): Promise<number> {
  const { ui, root } = ctx;
  const p = ui.palette;
  const started = performance.now();
  const config = loadConfig(root);
  const files = resolveFiles(root, positionals);
  if (!files.length) {
    if (ui.json) ui.data({ ok: true, files: [], durationMs: 0 });
    ui.warn("No Lucent files found (*.lucent.ts or *.lucent.tsx).");
    ui.hint("Run lucent init to add a starter module, or pass files explicitly.");
    return 0;
  }
  ui.heading("check", `lucent check ${p.dim(count(files.length, "file"))}`);
  const reports = files.map((file) => analyzeFile(root, file, config));
  let errors = 0;
  let warnings = 0;
  for (const report of reports) {
    const e = errorCount(report);
    const w = warningCount(report);
    errors += e;
    warnings += w;
    if (ui.json) continue;
    const tally = `${e ? p.red(` ${count(e, "error")}`) : ""}${w ? p.yellow(` ${count(w, "warning")}`) : ""}`;
    ui.step(e ? "fail" : w ? "warn" : "ok", `${report.file}${tally}`);
    for (const text of report.rendered) ui.error("\n" + colorizeDiagnostic(text, p));
  }
  const durationMs = elapsed(started);
  if (ui.json) {
    const entries = reports.map((r) => ({
      file: r.file,
      ok: errorCount(r) === 0,
      diagnostics: structuredDiagnostics(r),
    }));
    ui.data({ ok: errors === 0, files: entries, durationMs });
    return errors ? 1 : 0;
  }
  ui.line();
  const warningTally = warnings ? `, ${count(warnings, "warning")}` : "";
  if (!errors) {
    ui.ok(`${p.bold(count(files.length, "file"))} checked, no errors${warningTally} ${p.dim(`(${durationMs} ms)`)}`);
    return 0;
  }
  ui.error(
    `${ui.glyph("fail")} ${p.red(`${count(errors, "error")}${warningTally} in ${count(files.length, "file")}`)}`,
  );
  return 1;
}
