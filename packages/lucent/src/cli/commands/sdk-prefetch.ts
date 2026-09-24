import { extractionCount, projectFiles, sdkModule, sdkModules } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk, sdkImports } from "../project.ts";
import { plainSteps, type Steps } from "../ui/steps.ts";

/**
 * `lucent sdk prefetch`: extracts SDK bindings into the cache ahead of use
 * (default: the modules the project imports), one step per module.
 */
export async function run({ root, flags, out }: Invocation): Promise<number> {
  const t = out.theme;
  // `--ios` alone: every module of the platform.
  const listed = (p: string) => (typeof flags[p] === "string" ? (flags[p] as string).split(",").filter(Boolean) : undefined);
  let wanted: { ios?: string[]; android?: string[] } = { ios: listed("ios"), android: listed("android") };
  if (!wanted.ios && !wanted.android && !flags.all) wanted = sdkImports(projectFiles(root));
  const sdk = projectSdk(root);
  const jobs: ["ios" | "android", string][] = [];
  let failed = 0;
  for (const p of ["ios", "android"] as const) {
    let modules = wanted[p];
    // Every module: --all, or the platform's flag given without a list. An empty list of imports is nothing.
    if (flags.all || flags[p] === "") {
      const everything = sdkModules(p, sdk);
      if (!Array.isArray(everything)) {
        out.error(`${t.error(t.symbols.fail)} ${everything.missing}`);
        failed++;
        continue;
      }
      modules = everything;
    }
    for (const m of modules ?? []) jobs.push([p, m]);
  }

  const steps: Steps = out.json ? plainSteps(() => {}, t) : out.terminal.interactive ? (await import("../ui/live-steps.tsx")).liveSteps(t) : plainSteps((l) => out.print(l), t);
  let extracted = 0;
  let cached = 0;
  try {
    for (const [i, [p, m]] of jobs.entries()) {
      const name = `lucent:${p}/${m}`;
      steps.start(name, `${name}  ${t.dim(`${i + 1}/${jobs.length}`)}`);
      await steps.flush();
      const t0 = Date.now();
      const before = extractionCount();
      const r = sdkModule(p, m, sdk);
      if ("missing" in r) {
        steps.finish({ name, label: name, status: "failed", detail: r.missing });
        failed++;
      } else if (extractionCount() > before) {
        steps.finish({ name, label: name, status: "ok", ms: Date.now() - t0 });
        extracted++;
      } else {
        steps.finish({ name, label: name, status: "cached" });
        cached++;
      }
    }
  } finally {
    await steps.close();
  }
  if (out.json) {
    out.data({ ok: failed === 0, modules: steps.results.map((s) => ({ module: s.name, status: s.status, ...(s.ms !== undefined ? { ms: s.ms } : {}), ...(s.detail ? { error: s.detail } : {}) })) });
    return failed ? 1 : 0;
  }
  const parts = [extracted && `${extracted} extracted`, cached && `${cached} cached`, failed && t.error(`${failed} failed`)].filter(Boolean);
  out.print(`\n${jobs.length} module${jobs.length === 1 ? "" : "s"}: ${parts.join(", ") || "nothing to do"}`);
  return failed ? 1 : 0;
}
