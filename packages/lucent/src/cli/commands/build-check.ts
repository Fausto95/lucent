import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, Target } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { buildProject, type BuildOutcome, nextText, plural } from "../pipeline.ts";
import type { Notice } from "../project.ts";
import { renderDiagnostic } from "../ui/diagnostic.ts";
import { duration, table } from "../ui/format.ts";
import { plainSteps, type Steps } from "../ui/steps.ts";
import { version } from "../version.ts";

/** `lucent build` and `lucent check`: check always, write the native package for build. */
export async function buildOrCheck(
  command: "build" | "check",
  { root, flags, out }: Invocation,
): Promise<number> {
  const theme = out.theme;
  const notices: Notice[] = [];
  const notify = (n: Notice) => {
    notices.push(n);
    out.print(
      `${n.level === "ok" ? theme.success(theme.symbols.ok) : theme.warn(theme.symbols.warn)} ${n.text}`,
    );
  };
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
        platforms:
          typeof flags.platforms === "string" && flags.platforms
            ? (flags.platforms.split(",") as Target[])
            : undefined,
        out: typeof flags.out === "string" ? flags.out : undefined,
        prefetch: true,
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
        errors: result.diagnostics.length,
        ms: result.ms,
      });
    else
      out.data({
        ok: result.ok,
        upToDate: result.upToDate,
        out: path.resolve(root, typeof flags.out === "string" ? flags.out : ".lucent/native"),
        modules: result.modules,
        steps: steps.results,
        diagnostics: result.diagnostics,
        notices,
        next: result.next,
        ms: result.ms,
      });
    return result.ok ? 0 : 1;
  }
  if (result.fatal) {
    out.error(`${theme.error(theme.symbols.fail)} ${result.fatal}`);
    return 1;
  }
  if (!result.ok) {
    problems(result.diagnostics, result.modules.length, result.ms, command === "build");
    return 1;
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
  return 0;

  function problems(diagnostics: Diagnostic[], modules: number, ms: number, build: boolean): void {
    const sources = new Map<string, string | undefined>();
    const source = (file: string) => {
      if (!sources.has(file)) {
        const abs = path.resolve(root, file);
        sources.set(file, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined);
      }
      return sources.get(file);
    };
    out.error("");
    for (const d of diagnostics)
      out.error(`${renderDiagnostic(d, d.file ? source(d.file) : undefined, theme)}\n`);
    const summary = `${plural(diagnostics.length, "error")} ${theme.dim("·")} ${plural(modules, "module")} ${theme.dim("·")} ${duration(ms)}`;
    out.error(`  ${theme.error(summary)}${build ? theme.dim("  nothing was written") : ""}`);
  }
}
