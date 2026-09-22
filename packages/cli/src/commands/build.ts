import { relative } from "node:path";
import { colorizeDiagnostic } from "../diagnostics.ts";
import { build, defaultOutDir, type BuildResult, type HostName } from "../index.ts";
import { count } from "../ui.ts";
import { elapsed, HOST_OPTION, NEXT_STEPS, resolveFiles, resolveHost, watchLoop } from "./shared.ts";
import { defineCommand, type CommandContext } from "./types.ts";

interface BuildParams {
  host: HostName;
  out: string | undefined;
  files: readonly string[];
  emitIR: boolean;
  force: boolean;
  postGenerate: boolean;
}

export const buildCommand = defineCommand({
  name: "build",
  glyph: "build",
  summary: "Compile *.lucent.ts into a native package",
  usage: "[options] [files…]",
  options: {
    host: HOST_OPTION,
    out: {
      type: "string",
      placeholder: "<dir>",
      description: "Output directory (default: modules/lucent or .lucent/nitro)",
    },
    "emit-ir": { type: "boolean", description: "Also write each module's IR text to .lucent/ir/" },
    force: { type: "boolean", short: "f", description: "Ignore the cache and recompile everything" },
    postgen: { type: "boolean", default: true, description: "Skip the host's post-generate step (nitrogen)" },
    watch: { type: "boolean", short: "w", description: "Rebuild whenever a Lucent file or the config changes" },
  },
  examples: [
    { command: "lucent build", note: "Build for the host found in package.json" },
    { command: "lucent build --host nitro --watch", note: "Rebuild the Nitro package on every change" },
    { command: "lucent build --emit-ir src/geo.lucent.ts", note: "Build one file and dump its IR" },
    { command: "lucent build --json", note: "Machine-readable result for CI" },
  ],
  async run(ctx, values, positionals) {
    const params: BuildParams = {
      host: resolveHost(ctx, values.host),
      out: values.out,
      files: positionals,
      emitIR: values["emit-ir"] ?? false,
      force: values.force ?? false,
      postGenerate: values.postgen ?? true,
    };
    const once = (): Promise<number> => buildOnce(ctx, params);
    const code = await once();
    return values.watch ? watchLoop(ctx, once) : code;
  },
});

async function buildOnce(ctx: CommandContext, params: BuildParams): Promise<number> {
  const { ui, root } = ctx;
  const started = performance.now();
  const files = resolveFiles(root, params.files);
  if (!files.length) {
    const outDir = params.out ?? defaultOutDir(params.host);
    if (ui.json)
      ui.data({ ok: true, host: params.host, outDir, compiled: [], cached: [], diagnostics: [], durationMs: 0 });
    ui.warn("No Lucent files found (*.lucent.ts or *.lucent.tsx).");
    ui.hint("Run lucent init to add a starter module, or pass files explicitly.");
    return 0;
  }
  ui.heading("build", `lucent build ${ui.palette.dim(`(${params.host})`)}`);
  const result = await build({
    root,
    host: params.host,
    files,
    emitIR: params.emitIR,
    force: params.force,
    postGenerate: params.postGenerate,
    ...(params.out === undefined ? {} : { outDir: params.out }),
  });
  return report(ctx, result, params.host, started);
}

function report(ctx: CommandContext, result: BuildResult, host: HostName, started: number): number {
  const { ui } = ctx;
  const p = ui.palette;
  const outDir = relative(ctx.root, result.outDir);
  const errors = result.diagnostics.filter((d) => d.severity !== "warning").length;
  const warnings = result.diagnostics.length - errors;
  const durationMs = elapsed(started);
  if (ui.json) {
    ui.data({
      ok: result.ok,
      host,
      outDir,
      compiled: result.compiled,
      cached: result.cached,
      diagnostics: result.diagnostics,
      durationMs,
    });
    return result.ok ? 0 : 1;
  }
  for (const file of result.compiled) ui.step("compile", `${file} ${p.dim("compiled")}`);
  for (const file of result.cached) ui.step("cached", `${file} ${p.dim("cached")}`);
  for (const d of result.diagnostics) ui.error("\n" + colorizeDiagnostic(d.rendered, p));
  ui.line();
  if (result.ok) {
    const summary = `${p.bold(`${result.compiled.length} compiled`)} · ${result.cached.length} cached → ${p.cyan(outDir)}`;
    ui.ok(`${summary} ${p.dim(`(${durationMs} ms)`)}`);
    if (warnings) ui.warn(`${count(warnings, "warning")}, see above`);
    ui.hint(NEXT_STEPS[host]);
    return 0;
  }
  const tally = `${count(errors, "error")}${warnings ? `, ${count(warnings, "warning")}` : ""}`;
  ui.error(`${ui.glyph("fail")} ${p.red(`Build failed: ${tally}`)} ${p.dim(`(${durationMs} ms)`)}`);
  return 1;
}
