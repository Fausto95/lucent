import fs from "node:fs";
import path from "node:path";
import {
  type ViewCoverage,
  projectFiles,
  sdkCoverage,
  type SdkCoverage,
  sdkModule,
  sdkModules,
  toolkitsFrom,
  viewCoverage,
} from "@lucent-lang/compiler";
import {
  coverageSummary,
  ownTypes,
  sdkSourceModule,
  sdkTypeLookup,
  symbolKey,
  type TypeLookup,
} from "@lucent-lang/bindgen";
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
 * With `--views` (views on), each module's view classes too: what their
 * JSX tags take by rule, and what the rules leave out. `--all` takes
 * every module of each SDK there is; `--summary <file>` appends a markdown
 * summary (CI's step summary) of the reasons members are left out.
 * `--check <baseline>` fails when a module's unrepresentable share grows
 * past the baseline's; `--update <baseline>` writes the reports into it,
 * each with the SDK it was read from.
 */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;
  const sdk = projectSdk(root);
  const list = (flag: string) =>
    (typeof flags[flag] === "string" ? (flags[flag] as string) : "").split(",").filter(Boolean);
  // `*`: every module of the platform's SDK, where there is one.
  const wanted = flags.all
    ? { ios: ["*"], android: ["*"] }
    : { ios: list("ios"), android: list("android") };
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

  const reports: (SdkCoverage & { views?: ViewCoverage[] })[] = [];
  // With --all, a module the SDK lists but its extractor cannot read (IOKit for the simulator).
  const unread: { module: string; reason: string }[] = [];
  for (const platform of ["ios", "android"] as const) {
    // `android.*`: every module with the prefix; `*`, every module.
    const listed = () => {
      const all = sdkModules(platform, sdk);
      return "missing" in all ? [] : all;
    };
    const modules: string[] = [];
    for (const m of wanted[platform]) {
      const matched =
        m === "*"
          ? listed()
          : m.endsWith(".*")
            ? listed().filter((x) => x.startsWith(m.slice(0, -1)))
            : [m];
      // A prefix a gate names must match: one that matches nothing would gate nothing.
      if (!matched.length && m !== "*" && !flags.all) {
        out.error(
          `${t.error(t.symbols.fail)} ${m}: no ${platform} module matches${platform === "android" ? " (androidx and Play services packages are the app's dependencies: run it in the app, after its Gradle build has resolved them)" : ""}`,
        );
        return 1;
      }
      modules.push(...matched);
    }
    // Members are judged with the types other modules declare, as builds judge them.
    const others = sdkTypeLookup(platform, sdk);
    for (const m of modules) {
      const r = sdkModule(platform, m, sdk);
      if ("missing" in r) {
        if (flags.all) {
          out.error(`${t.warn(t.symbols.warn)} ${r.missing}`);
          unread.push({ module: m, reason: r.missing.replace(/^lucent:\w+\/[^:]+: /, "") });
          continue;
        }

        out.error(`${t.error(t.symbols.fail)} ${r.missing}`);
        return 1;
      }
      const moduleOf = (name: string) => {
        const found = sdkModule(platform, name, sdk);
        return "missing" in found ? undefined : found.schema;
      };
      const views = flags.views ? viewCoverage(r.schema, moduleOf) : undefined;
      const own = ownTypes(r.schema);
      const types: TypeLookup = (module, name) =>
        module === r.schema.module ? own(module, name) : others(module, name);
      reports.push({ ...sdkCoverage(r.schema, types, evidence), ...(views ? { views } : {}) });

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

    for (const c of reports) {
      if (!c.views?.length) continue;

      out.print("");
      out.print(t.bold(`${c.module} views`));
      for (const line of table([
        ["view", "made", "props", "events", "children", "left out"].map((h) => t.dim(h)),
        ...c.views.map((v) => [
          v.view,
          v.made,
          String(v.props.length),
          String(v.events.length),
          v.children ? "yes" : "-",
          String(v.leftOut.length),
        ]),
      ]))
        out.print(line.trimEnd());

      // Each attribute, with the rule and artifact that made it, on request.
      if (flags.members)
        for (const v of c.views)
          for (const a of [...v.props, ...v.events])
            out.print(`  ${v.view} ${a.name}: ${t.dim(a.explanation)}`);
    }

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

  if (typeof flags.summary === "string")
    fs.appendFileSync(path.resolve(root, flags.summary), coverageSummary(reports, 20, unread));

  // The reports as a baseline records them: without members, each with the SDK it was read from.
  const updateFile = typeof flags.update === "string" ? flags.update : "";
  if (updateFile) {
    const file = path.resolve(root, updateFile);
    const before = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as SdkCoverage[])
      : [];
    const now = new Map(
      reports.map((report) => {
        const c: Partial<typeof report> = { ...report };
        delete c.members;
        delete c.views;
        return [report.module, c];
      }),
    );
    const kept = before.map((b) => now.get(b.module) ?? b);
    const added = [...now.values()].filter((c) => !before.some((b) => b.module === c.module));
    fs.writeFileSync(file, `${JSON.stringify([...kept, ...added], null, 2)}\n`);
  }

  const baselineFile = typeof flags.check === "string" ? flags.check : "";
  if (!baselineFile) return 0;
  const baseline = new Map(
    (JSON.parse(fs.readFileSync(baselineFile, "utf8")) as SdkCoverage[]).map((c) => [c.module, c]),
  );
  // Shares, not counts: another SDK version has other members.
  const share = (c: SdkCoverage) => (c.total ? (100 * c.unrepresentable) / c.total : 0);
  let dropped = false;
  // A module the gate reads and the baseline lacks gates nothing: said, so a widened gate is seen.
  const listed = (ms: string[]) =>
    `${ms.length} module${ms.length === 1 ? "" : "s"} (${ms.slice(0, 5).join(", ")}${ms.length > 5 ? ", …" : ""})`;
  const ungated = reports.filter((c) => !baseline.has(c.module)).map((c) => c.module);
  if (ungated.length)
    process.stderr.write(
      `${t.symbols.warn} ${listed(ungated)} not in the baseline, so not gated: add them with --update ${baselineFile}\n`,
    );
  const unknown = reports.filter(
    (c) => c.sdk && baseline.get(c.module) && !baseline.get(c.module)!.sdk,
  );
  if (unknown.length)
    process.stderr.write(
      `${t.symbols.warn} the baseline does not say which SDK ${listed(unknown.map((c) => c.module))} were read from (these are ${[...new Set(unknown.map((c) => c.sdk))].join(", ")}): record it with --update ${baselineFile}\n`,
    );
  for (const c of reports) {
    const b = baseline.get(c.module);
    // Another SDK has other members: the share still gates, and the note says why it moved.
    if (b?.sdk && c.sdk && b.sdk !== c.sdk)
      process.stderr.write(
        `${t.symbols.warn} ${c.module}: read from ${c.sdk}, the baseline from ${b.sdk}\n`,
      );
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
