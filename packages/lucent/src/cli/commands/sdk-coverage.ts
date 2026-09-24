import fs from "node:fs";
import { projectFiles, sdkCoverage, type SdkCoverage, sdkModule, sdkModules } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk, sdkImports } from "../project.ts";

/** `lucent sdk coverage`: per module, how much Lucent code can call, and how. */
export function run({ root, flags }: Invocation): number {
  const sdk = projectSdk(root);
  const list = (flag: string) => (typeof flags[flag] === "string" ? (flags[flag] as string) : "").split(",").filter(Boolean);
  const wanted = { ios: list("ios"), android: list("android") };
  if (!wanted.ios.length && !wanted.android.length) Object.assign(wanted, sdkImports(projectFiles(root)));
  const reports: SdkCoverage[] = [];
  for (const platform of ["ios", "android"] as const) {
    // `android.*`: every module with the prefix.
    const listed = () => {
      const all = sdkModules(platform, sdk);
      return "missing" in all ? [] : all;
    };
    const modules = wanted[platform].flatMap((m) => (m.endsWith(".*") ? listed().filter((x) => x.startsWith(m.slice(0, -1))) : [m]));
    for (const m of modules) {
      const r = sdkModule(platform, m, sdk);
      if ("missing" in r) {
        process.stderr.write(`✗ ${r.missing}\n`);
        return 1;
      }
      reports.push(sdkCoverage(r.schema));
    }
  }
  if (flags.json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  else {
    const pct = (n: number, t: number) => `${t ? ((100 * n) / t).toFixed(1) : "0.0"}%`;
    process.stdout.write(`${"module".padEnd(28)} ${"total".padStart(7)} ${"idiomatic".padStart(10)} ${"raw".padStart(8)} ${"unrepresentable".padStart(16)}\n`);
    for (const c of reports) process.stdout.write(`${c.module.padEnd(28)} ${String(c.total).padStart(7)} ${String(c.idiomatic).padStart(10)} ${String(c.raw).padStart(8)} ${`${c.unrepresentable} (${pct(c.unrepresentable, c.total)})`.padStart(16)}\n`);
  }
  const baselineFile = typeof flags.check === "string" ? flags.check : "";
  if (!baselineFile) return 0;
  const baseline = new Map((JSON.parse(fs.readFileSync(baselineFile, "utf8")) as SdkCoverage[]).map((c) => [c.module, c]));
  // Shares, not counts: another SDK version has other members.
  const share = (c: SdkCoverage) => (c.total ? (100 * c.unrepresentable) / c.total : 0);
  let dropped = false;
  for (const c of reports) {
    const b = baseline.get(c.module);
    if (b && share(c) > share(b) + 0.05) {
      process.stderr.write(`✗ ${c.module}: ${share(c).toFixed(2)}% unrepresentable, ${share(b).toFixed(2)}% in the baseline\n`);
      dropped = true;
    }
  }
  return dropped ? 1 : 0;
}
