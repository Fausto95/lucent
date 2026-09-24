import fs from "node:fs";
import { projectFiles, sdkCoverage, type SdkCoverage, sdkModule, sdkModules } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk, sdkImports } from "../project.ts";
import { table } from "../ui/format.ts";

/** `lucent sdk coverage`: per module, how much Lucent code can call, and how. */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;
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
        out.error(`${t.error(t.symbols.fail)} ${r.missing}`);
        return 1;
      }
      reports.push(sdkCoverage(r.schema));
    }
  }
  if (flags.json) out.data(reports);
  else {
    const pct = (n: number, t: number) => `${t ? ((100 * n) / t).toFixed(1) : "0.0"}%`;
    const rows = reports.map((c) => [c.module, String(c.total), String(c.idiomatic), String(c.raw), `${c.unrepresentable} (${pct(c.unrepresentable, c.total)})`]);
    for (const line of table([["module", "total", "idiomatic", "raw", "unrepresentable"].map((h) => t.dim(h)), ...rows])) out.print(line);
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
      // stderr even with --json: CI redirects the report and reads this.
      process.stderr.write(`${t.symbols.fail} ${c.module}: ${share(c).toFixed(2)}% unrepresentable, ${share(b).toFixed(2)}% in the baseline\n`);
      dropped = true;
    }
  }
  return dropped ? 1 : 0;
}
