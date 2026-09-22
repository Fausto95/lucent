import { relative } from "node:path";
import { colorizeDiagnostic } from "../diagnostics.ts";
import { build, defaultOutDir, type BuildResult, type HostName } from "../index.ts";
import { staticEstimates } from "../static-estimates.ts";
import { count } from "../ui.ts";
import { elapsed, HOST_OPTION, NEXT_STEPS, resolveFiles, resolveHost, watchLoop } from "./shared.ts";
import { defineCommand, type CommandContext } from "./types.ts";

interface BuildParams {
  host: HostName;
  out: string | undefined;
  files: readonly string[];
  emitIR: boolean;
  emitAst: boolean;
  force: boolean;
  postGenerate: boolean;
  optimize: boolean;
  analyze: boolean;
  explain: boolean;
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
    emit: {
      type: "string",
      placeholder: "<stage>",
      values: ["hir", "ir", "ast"],
      description: "Emit stage: hir/ir write IR text; ast prints surface function names",
    },
    "emit-ir": {
      type: "boolean",
      description: "Also write each module's IR text to .lucent/ir/ (alias of --emit hir)",
    },
    force: { type: "boolean", short: "f", description: "Ignore the cache and recompile everything" },
    postgen: { type: "boolean", default: true, description: "Skip the host's post-generate step (nitrogen)" },
    watch: { type: "boolean", short: "w", description: "Rebuild whenever a Lucent file or the config changes" },
    optimize: { type: "boolean", description: "Run optional HIR optimization passes" },
    analyze: { type: "boolean", description: "Print static IR estimates (native/async calls, JS exports)" },
    explain: { type: "boolean", description: "Print the optimization log (requires --optimize)" },
  },
  examples: [
    { command: "lucent build", note: "Build for the host found in package.json" },
    { command: "lucent build --host nitro --watch", note: "Rebuild the Nitro package on every change" },
    { command: "lucent build --emit hir src/geo.lucent.ts", note: "Build one file and dump its HIR/IR" },
    { command: "lucent build --emit-ir src/geo.lucent.ts", note: "Alias of --emit hir" },
    { command: "lucent build --emit ast", note: "Print surface function names after build" },
    { command: "lucent build --analyze", note: "Show static IR cost estimates" },
    { command: "lucent build --optimize --explain", note: "Optimize and print what changed" },
    { command: "lucent build --json", note: "Machine-readable result for CI" },
  ],
  async run(ctx, values, positionals) {
    const emit = values.emit;
    const params: BuildParams = {
      host: resolveHost(ctx, values.host),
      out: values.out,
      files: positionals,
      emitIR: (values["emit-ir"] ?? false) || emit === "hir" || emit === "ir",
      emitAst: emit === "ast",
      force: values.force ?? false,
      postGenerate: values.postgen ?? true,
      optimize: values.optimize ?? false,
      analyze: values.analyze ?? false,
      explain: values.explain ?? false,
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
    // Explain needs a fresh optimize log; cached modules do not store one.
    force: params.force || (params.explain && params.optimize),
    postGenerate: params.postGenerate,
    ...(params.optimize ? { optimize: true } : {}),
    ...(params.out === undefined ? {} : { outDir: params.out }),
  });
  return report(ctx, result, params, started);
}

function report(ctx: CommandContext, result: BuildResult, params: BuildParams, started: number): number {
  const { ui } = ctx;
  const p = ui.palette;
  const outDir = relative(ctx.root, result.outDir);
  const errors = result.diagnostics.filter((d) => d.severity !== "warning").length;
  const warnings = result.diagnostics.length - errors;
  const durationMs = elapsed(started);
  const estimates = params.analyze ? staticEstimates(result.modules) : null;
  if (ui.json) {
    ui.data({
      ok: result.ok,
      host: params.host,
      outDir,
      compiled: result.compiled,
      cached: result.cached,
      diagnostics: result.diagnostics,
      durationMs,
      ...(estimates ? { staticEstimates: estimates } : {}),
      ...(params.emitAst
        ? {
            ast: result.modules.map((m) => ({
              module: m.name,
              functions: m.functions.map((fn) => fn.name),
            })),
          }
        : {}),
      ...(params.explain ? { optimizeLog: params.optimize ? result.optimizeLog : ["Optimization disabled"] } : {}),
    });
    return result.ok ? 0 : 1;
  }
  for (const file of result.compiled) ui.step("compile", `${file} ${p.dim("compiled")}`);
  for (const file of result.cached) ui.step("cached", `${file} ${p.dim("cached")}`);
  for (const d of result.diagnostics) ui.error("\n" + colorizeDiagnostic(d.rendered, p));
  if (estimates) {
    ui.line();
    ui.heading("check", "static estimates");
    ui.rows([
      [p.dim("Native calls"), String(estimates.nativeCalls)],
      [p.dim("Async calls"), String(estimates.asyncCalls)],
      [p.dim("JS exports"), String(estimates.jsExports)],
    ]);
  }
  if (params.emitAst && result.ok) {
    ui.line();
    ui.heading("ir", "ast (surface functions)");
    for (const mod of result.modules) {
      const names = mod.functions.map((fn) => fn.name);
      ui.line(`${mod.name}: ${names.length ? names.join(", ") : p.dim("(none)")}`);
    }
  }
  if (params.explain) {
    ui.line();
    ui.heading("explain", "optimization");
    if (!params.optimize) ui.line("Optimization disabled");
    else if (!result.optimizeLog.length) ui.line(p.dim("No optimization messages."));
    else for (const line of result.optimizeLog) ui.line(line);
  }
  ui.line();
  if (result.ok) {
    const summary = `${p.bold(`${result.compiled.length} compiled`)} · ${result.cached.length} cached → ${p.cyan(outDir)}`;
    ui.ok(`${summary} ${p.dim(`(${durationMs} ms)`)}`);
    if (warnings) ui.warn(`${count(warnings, "warning")}, see above`);
    ui.hint(NEXT_STEPS[params.host]);
    return 0;
  }
  const tally = `${count(errors, "error")}${warnings ? `, ${count(warnings, "warning")}` : ""}`;
  ui.error(`${ui.glyph("fail")} ${p.red(`Build failed: ${tally}`)} ${p.dim(`(${durationMs} ms)`)}`);
  return 1;
}
