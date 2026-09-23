/**
 * Headless check of an example app's full JavaScript + native pipeline:
 *   1. `lucent build` (the exact C++ the app compiles on device);
 *   2. builds that C++ with the Hermes test host;
 *   3. bundles the app's test cases with the app's own Metro config
 *      (transformer, proxies, runtime loader);
 *   4. runs the bundle in Hermes against the native modules.
 *
 *   tsx scripts/app-check.ts [apps/bare-example]
 *
 * Needs HERMES_DIR (a Hermes checkout built into build/).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.resolve(root, process.argv[2] ?? "apps/bare-example");
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const work = path.join(os.tmpdir(), "lucent-app-check", path.basename(app));

function sh(cmd: string, args: string[], cwd = root): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

fs.mkdirSync(work, { recursive: true });
console.log("• lucent build");
sh(process.execPath, [path.join(root, "packages/cli/bin/lucent.cjs"), "build", "--root", app]);

console.log("• compiling native code");
const cpp = path.join(app, ".lucent/native/cpp");
const flags = ["-std=c++20", "-ffp-contract=off", "-O1", "-g", "-w", `-I${cpp}`, `-I${cpp}/generated`, `-I${hermes}/API`, `-I${hermes}/API/jsi`, `-I${hermes}/public`];
const sources = [
  ...fs.readdirSync(path.join(cpp, "generated")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(cpp, "generated", f)),
  ...fs.readdirSync(path.join(cpp, "lucent")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(cpp, "lucent", f)),
  ...fs.readdirSync(path.join(cpp, "lucent/jsi")).filter((f) => f.endsWith(".cpp")).map((f) => path.join(cpp, "lucent/jsi", f)),
  path.join(root, "packages/runtime/test/jsi/harness.cpp"),
];
const objs = sources.map((s, i) => {
  const o = path.join(work, `${i}_${path.basename(s, ".cpp")}.o`);
  sh(process.env.CXX ?? "clang++", [...flags, "-c", s, "-o", o]);
  return o;
});
const exe = path.join(work, "apphost");
sh(process.env.CXX ?? "clang++", [...objs, `-L${hermes}/build/lib`, `-L${hermes}/build/jsi`, "-lhermesvm", "-ljsi", "-lpthread", ...(process.platform === "darwin" ? ["-framework", "CoreFoundation"] : []), `-Wl,-rpath,${hermes}/build/lib`, `-Wl,-rpath,${hermes}/build/jsi`, "-o", exe]);

console.log("• bundling with Metro");
const entry = path.join(app, "lucent-app-check.entry.js");
fs.writeFileSync(
  entry,
  `import { cases } from "./src/tests";
async function main() {
  let failed = 0;
  for (const c of cases) {
    const lines = [];
    const out = (...a) => lines.push(a.map((x) => String(x)).join(" "));
    let error;
    try { c.run(c.module, out, (x) => x, {}); } catch (e) { error = String(e); }
    const deadline = Date.now() + 10000;
    while (!error && lines.length < c.expected.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const ok = !error && lines.length === c.expected.length && lines.every((l, i) => l === c.expected[i]);
    if (!ok) failed++;
    print((ok ? "PASS " : "FAIL ") + c.name + (error ? " " + error : ""));
    if (!ok) lines.forEach((l, i) => { if (l !== c.expected[i]) print("   got: " + l + "\\n  want: " + c.expected[i]); });
  }
  print(failed ? failed + " FAILED" : "ALL PASSED");
}
main();
`,
);
const metroConfig = path.join(work, "metro.config.js");
fs.writeFileSync(
  metroConfig,
  `const base = require(${JSON.stringify(path.join(app, "metro.config.js"))});
module.exports = { ...base, projectRoot: ${JSON.stringify(app)}, serializer: { ...base.serializer, getModulesRunBeforeMainModule: () => [], getPolyfills: () => [] } };
`,
);
const bundle = path.join(work, "bundle.js");
try {
  sh(process.execPath, [path.join(root, "node_modules/react-native/cli.js"), "bundle", "--config", metroConfig, "--platform", "android", "--dev", "false", "--minify", "false", "--entry-file", entry, "--bundle-output", bundle, "--reset-cache"], app);
} finally {
  fs.rmSync(entry);
}

console.log("• running in Hermes");
const pre = path.join(work, "pre.js");
fs.writeFileSync(pre, 'var process = { env: { NODE_ENV: "production" } };\n');
const r = spawnSync(exe, [path.join(root, "packages/runtime/test/jsi/abort-polyfill.js"), pre, bundle], { encoding: "utf8", timeout: 120000 });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
if (r.status !== 0 || !r.stdout.includes("ALL PASSED")) process.exit(1);
