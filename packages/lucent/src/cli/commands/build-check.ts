import { nativeOut } from "../native-out.ts";
import fs from "node:fs";
import path from "node:path";
import {
  type Diagnostic,
  POD_INSTALL_RECORD,
  podSourcesDigest,
  type Target,
} from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { ACTION_TEXT, filesText, needsPodInstall } from "../changes.ts";
import type { PendingAction } from "../build-graph.ts";
import { buildProject, type BuildOutcome, nextText, plural } from "../pipeline.ts";
import type { Notice } from "../project.ts";
import { renderDiagnostic } from "../ui/diagnostic.ts";
import { duration, table } from "../ui/format.ts";
import { plainSteps, type Steps } from "../ui/steps.ts";
import { version } from "../version.ts";

/** The targets `--platforms` may name. */
const TARGETS: readonly Target[] = ["ios", "android", "host"];

/**
 * The targets `--platforms` names (undefined: none given), or why they
 * are not targets: a misspelt one would otherwise build nothing for it,
 * and remove what the last build wrote for the others.
 */
export function parsePlatforms(flag: string | boolean | undefined): Target[] | undefined | string {
  if (typeof flag !== "string" || !flag) return undefined;
  const given = flag.split(",").map((p) => p.trim());
  const unknown = given.filter((p) => !TARGETS.includes(p as Target));
  if (unknown.length || !given.length)
    return `--platforms takes ${TARGETS.join(", ")} (comma-separated), not ${unknown.join(", ") || JSON.stringify(flag)}`;
  return [...new Set(given)] as Target[];
}

/**
 * A diagnostic as Xcode reads a script's output: an issue at its file and
 * line, which the issue navigator opens.
 */
export function xcodeIssue(root: string, d: Diagnostic): string {
  const where = d.file ? `${path.resolve(root, d.file)}:${d.line}:${d.column}: ` : "";

  return `${where}${d.severity === "warning" ? "warning" : "error"}: ${d.code}: ${d.message}`;
}

/**
 * Why Xcode's build would miss what this build wrote: LucentNative's
 * podspec or sources differ from what pod install saw, as the podspec
 * recorded it (POD_INSTALL_RECORD), and CocoaPods lists a pod's files at pod
 * install. Undefined when they don't, or when nothing was recorded.
 */
export function podInstallStale(outDir: string, actions: PendingAction[]): string | undefined {
  const record = path.join(outDir, POD_INSTALL_RECORD);
  if (!fs.existsSync(record)) return undefined;

  const now = podSourcesDigest(outDir);
  if (!now || fs.readFileSync(record, "utf8").trim() === now) return undefined;

  const changed = actions.filter((a) => a.kind === "relink" && a.targets.includes("ios"));
  const files = changed.flatMap((a) => a.files);
  const which = needsPodInstall(actions) && files.length ? ` (${filesText(files, 3)})` : "";

  return `the native package's sources or podspec changed since pod install${which}, and Xcode builds the files pod install listed: run pod install in ios/, then build again`;
}

/** `lucent build` and `lucent check`: check always, write the native package for build. */
export async function buildOrCheck(
  command: "build" | "check",
  { root, flags, out }: Invocation,
): Promise<number> {
  const theme = out.theme;
  // Run by LucentNative's build phase in Xcode (the podspec's script_phase).
  const xcode = command === "build" && process.env.LUCENT_XCODE_BUILD === "1";
  const sources = new Map<string, string | undefined>();
  const notices: Notice[] = [];
  const notify = (n: Notice) => {
    notices.push(n);
    out.print(
      `${n.level === "ok" ? theme.success(theme.symbols.ok) : theme.warn(theme.symbols.warn)} ${n.text}`,
    );
  };
  const platforms = parsePlatforms(flags.platforms);
  if (typeof platforms === "string") {
    if (out.json) out.data({ ok: false, error: platforms });
    else out.error(`${theme.error(theme.symbols.fail)} ${platforms}`);
    return 2;
  }
  if (command === "build")
    out.print(
      `${theme.brand(theme.symbols.brand)} ${theme.bold("lucent")} ${theme.dim(version())}\n`,
    );
  // check prints its problems only; --json prints one document.
  const quiet = command === "check" || out.json;
  const steps: Steps = quiet
    ? plainSteps(() => {}, theme)
    : out.terminal.interactive
      ? (await import("../ui/live-steps.tsx")).liveSteps(theme)
      : plainSteps((l) => out.print(l), theme);
  let result: BuildOutcome;
  try {
    result = await buildProject(
      root,
      {
        mode: command,
        force: !!flags.force,
        platforms,
        out: typeof flags.out === "string" ? flags.out : undefined,
        prefetch: true,
        frozen: !!flags.frozen,
      },
      steps,
      notify,
    );
  } finally {
    await steps.close();
  }

  if (out.json) {
    if (result.fatal) out.data({ ok: false, error: result.fatal });
    else if (command === "check")
      out.data({
        ok: result.ok,
        modules: result.modules.map((m) => m.name),
        diagnostics: result.diagnostics,
        warnings: result.warnings,
        errors: result.diagnostics.length,
        ms: result.ms,
      });
    else
      out.data({
        ok: result.ok,
        upToDate: result.upToDate,
        out: nativeOut(root, typeof flags.out === "string" ? flags.out : undefined),
        modules: result.modules,
        steps: steps.results,
        diagnostics: result.diagnostics,
        warnings: result.warnings,
        notices,
        next: result.next,
        actions: result.actions,
        ms: result.ms,
      });
    return result.ok ? 0 : 1;
  }
  if (result.fatal) {
    out.error(`${theme.error(theme.symbols.fail)} ${result.fatal}`);
    if (xcode) out.error(`error: ${result.fatal}`);
    return 1;
  }
  if (!result.ok) {
    problems(
      [...result.diagnostics, ...result.warnings],
      result.modules.length,
      result.ms,
      command === "build",
    );
    return 1;
  }
  if (result.warnings.length) {
    out.error("");
    for (const d of result.warnings)
      out.error(`${renderDiagnostic(d, d.file ? source(d.file) : undefined, theme)}\n`);
    if (xcode) for (const d of result.warnings) out.error(xcodeIssue(root, d));
  }
  if (xcode) {
    const stale = podInstallStale(
      nativeOut(root, typeof flags.out === "string" ? flags.out : undefined),
      result.actions,
    );
    if (stale) {
      out.error(`${theme.error(theme.symbols.fail)} ${stale}`);
      out.error(`error: ${stale}`);
      return 1;
    }
  }
  if (command === "check") {
    out.print(
      `${theme.success(theme.symbols.ok)} ${plural(result.modules.length, "module")}, no problems  ${theme.dim(result.upToDate ? `${duration(result.ms)} (unchanged since the last check)` : duration(result.ms))}`,
    );
    return 0;
  }
  if (result.upToDate) return 0;
  out.print("");
  for (const line of table(
    result.modules.map((m, i) => [i ? "" : theme.dim("modules"), m.name, m.platforms.join(" ")]),
  ))
    out.print(line);
  out.print(`${theme.dim("next")}     ${nextText(result.next)}`);

  // Each action the changes need, where, and the files that need it.
  for (const line of table(
    result.actions.map((a, i) => [
      i ? "" : theme.dim("actions"),
      ACTION_TEXT[a.kind],
      a.targets.join(", "),
      filesText(a.files),
    ]),
  ))
    out.print(line);

  return 0;

  function source(file: string): string | undefined {
    if (!sources.has(file)) {
      const abs = path.resolve(root, file);
      sources.set(file, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined);
    }
    return sources.get(file);
  }

  function problems(diagnostics: Diagnostic[], modules: number, ms: number, build: boolean): void {
    out.error("");
    for (const d of diagnostics)
      out.error(`${renderDiagnostic(d, d.file ? source(d.file) : undefined, theme)}\n`);
    if (xcode) for (const d of diagnostics) out.error(xcodeIssue(root, d));
    const errors = diagnostics.filter((d) => d.severity !== "warning").length;
    const summary = `${plural(errors, "error")} ${theme.dim("·")} ${plural(modules, "module")} ${theme.dim("·")} ${duration(ms)}`;
    out.error(`  ${theme.error(summary)}${build ? theme.dim("  no code was generated") : ""}`);
  }
}
