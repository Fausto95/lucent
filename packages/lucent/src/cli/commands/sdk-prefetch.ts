import { prefetchSdk, projectFiles, sdkModules } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk, sdkImports } from "../project.ts";

export function run({ root, flags }: Invocation): number {
  // `--ios` alone: every module of the platform.
  const listed = (p: string) => (typeof flags[p] === "string" ? (flags[p] as string).split(",").filter(Boolean) : undefined);
  const all = !!flags.all;
  let wanted = { ios: listed("ios"), android: listed("android") };
  if (!wanted.ios && !wanted.android && !all) wanted = sdkImports(projectFiles(root));
  let failed = 0;
  for (const p of ["ios", "android"] as const) {
    let modules = wanted[p];
    if (all || (modules && !modules.length)) {
      const everything = sdkModules(p, projectSdk(root));
      if (!Array.isArray(everything)) {
        process.stderr.write(`✗ ${everything.missing}\n`);
        failed++;
        continue;
      }
      modules = everything;
    }
    for (const [i, r] of prefetchSdk(p, modules ?? [], projectSdk(root)).entries()) {
      const name = `lucent:${p}/${modules![i]}`;
      if ("schema" in r) process.stdout.write(`✓ ${name}\n`);
      else {
        process.stderr.write(`✗ ${r.missing}\n`);
        failed++;
      }
    }
  }
  return failed ? 1 : 0;
}
