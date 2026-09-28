import fs from "node:fs";
import path from "node:path";
import {
  projectFiles,
  sdkCoverage,
  type SdkCoverage,
  sdkModule,
  sdkModules,
  toolkitsFrom,
} from "@lucent-lang/compiler";
import { sdkSourceModule, symbolKey } from "@lucent-lang/bindgen";
import type { Invocation } from "../args.ts";
import { projectSdk, sdkImports } from "../project.ts";
import { readUsage, USAGE_FILE } from "../sdk-usage.ts";
import { table } from "../ui/format.ts";

/**
 * `lucent sdk coverage`: per module, how far its members get: discovered,
 * representable, generated (by the project's last build, from
 * .lucent/sdk-usage.json) and exercised (by the tests or probes an
 * `--exercised` file lists). A toolkit generated from a module (while
 * views are on: lucent:swiftui, from SwiftUI) follows it, under its name.
 */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;
  const sdk = projectSdk(root);
  const list = (flag: string) =>
    (typeof flags[flag] === "string" ? (flags[flag] as string) : "").split(",").filter(Boolean);
  const wanted = { ios: list("ios"), android: list("android") };
  if (!wanted.ios.length && !wanted.android.length)
    Object.assign(wanted, sdkImports(projectFiles(root)));

  let evidence;
  try {
    evidence = readEvidence(
      root,
      typeof flags.exercised === "string" ? flags.exercised : "",
      (problem) =>
        out.error(
          `${t.warn(t.symbols.warn)} ${problem}: generated is unknown until the next check or build`,
        ),
    );
  } catch (e) {
    out.error(`${t.error(t.symbols.fail)} ${(e as Error).message}`);
    return 1;
  }

  const reports: SdkCoverage[] = [];
  for (const platform of ["ios", "android"] as const) {
    // `android.*`: every module with the prefix.
    const listed = () => {
      const all = sdkModules(platform, sdk);
      return "missing" in all ? [] : all;
    };
    const modules = wanted[platform].flatMap((m) =>
      m.endsWith(".*") ? listed().filter((x) => x.startsWith(m.slice(0, -1))) : [m],
    );
    for (const m of modules) {
      const r = sdkModule(platform, m, sdk);
      if ("missing" in r) {
        out.error(`${t.error(t.symbols.fail)} ${r.missing}`);
        return 1;
      }
      reports.push(sdkCoverage(r.schema, undefined, evidence));

      // A toolkit generated from the module (lucent:swiftui), under its own name.
      for (const toolkit of toolkitsFrom(platform, m)) {
        const source = sdkSourceModule(platform, m, sdk);
        if ("missing" in source) {
          out.error(`${t.error(t.symbols.fail)} ${toolkit}: ${source.missing}`);
          return 1;
        }
        reports.push({ ...sdkCoverage(source.schema, undefined, evidence), module: toolkit });
      }
    }
  }

  // Members only on request: every package of an SDK has tens of thousands.
  if (flags.json)
    out.data(flags.members ? reports : reports.map((c) => ({ ...c, members: undefined })));
  else {
    const pct = (n: number, t: number) => `${t ? ((100 * n) / t).toFixed(1) : "0.0"}%`;
    const known = (n: number | null) => (n === null ? "-" : String(n));
    const rows = reports.map((c) => [
      c.module,
      String(c.stages.discovered),
      String(c.stages.representable),
      `${c.unrepresentable} (${pct(c.unrepresentable, c.total)})`,
      known(c.stages.generated),
      known(c.stages.exercised),
    ]);
    for (const line of table([
      ["module", "discovered", "representable", "unrepresentable", "generated", "exercised"].map(
        (h) => t.dim(h),
      ),
      ...rows,
    ]))
      out.print(line);

    if (flags.members)
      for (const c of reports) {
        out.print("");
        out.print(t.bold(c.module));
        for (const line of table(
          c.members.map((m) => [`  ${t.dim(m.stage)}`, m.display, m.reason ?? t.dim(m.key ?? "")]),
        ))
          out.print(line.trimEnd());
      }
  }

  const baselineFile = typeof flags.check === "string" ? flags.check : "";
  if (!baselineFile) return 0;
  const baseline = new Map(
    (JSON.parse(fs.readFileSync(baselineFile, "utf8")) as SdkCoverage[]).map((c) => [c.module, c]),
  );
  // Shares, not counts: another SDK version has other members.
  const share = (c: SdkCoverage) => (c.total ? (100 * c.unrepresentable) / c.total : 0);
  let dropped = false;
  for (const c of reports) {
    const b = baseline.get(c.module);
    if (b && share(c) > share(b) + 0.05) {
      // stderr even with --json: CI redirects the report and reads this.
      process.stderr.write(
        `${t.symbols.fail} ${c.module}: ${share(c).toFixed(2)}% unrepresentable, ${share(b).toFixed(2)}% in the baseline\n`,
      );
      dropped = true;
    }
  }
  return dropped ? 1 : 0;
}

/**
 * What says members got past representable: the symbols the last build
 * used, and the keys an evidence file lists. None of either: unknown. A
 * usage report that cannot be read (`warn` says why) is none: a build
 * writes it anew.
 */
function readEvidence(
  root: string,
  exercisedFile: string,
  warn: (problem: string) => void,
): { generated?: Set<string>; exercised?: Set<string> } {
  const out: { generated?: Set<string>; exercised?: Set<string> } = {};

  try {
    const usage = readUsage(path.join(root, USAGE_FILE));
    if (usage) out.generated = new Set(usage.symbols.map(symbolKey));
  } catch (e) {
    warn((e as Error).message);
  }

  if (!exercisedFile) return out;

  const value = JSON.parse(fs.readFileSync(path.resolve(root, exercisedFile), "utf8")) as unknown;
  if (!Array.isArray(value) || !value.every((k) => typeof k === "string"))
    throw new Error(
      `${exercisedFile}: expected a JSON array of symbol keys (lucent sdk coverage --members --json lists them)`,
    );

  out.exercised = new Set(value);
  return out;
}
