/**
 * Builds @lucent-lang/lucent for publishing: bundles the CLI and the
 * compiler (with bindgen) into dist/, and copies the files the compiler
 * reads at run time next to it, where the bundled code looks for them:
 * lib/ (declarations) and runtime/ (C++ runtime, native templates, the JS
 * loader).
 *
 *   tsx scripts/build.mts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = path.resolve(pkg, "..");

for (const dir of ["dist", "lib", "runtime"]) fs.rmSync(path.join(pkg, dir), { recursive: true, force: true });

await build({
  entryPoints: { cli: path.join(pkg, "src/cli/main.ts"), compiler: path.join(packages, "compiler/src/index.ts") },
  outdir: path.join(pkg, "dist"),
  bundle: true,
  // The TypeScript plugin and the CLI share the compiler's code.
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  jsx: "automatic",
  // The published package's dependencies, resolved from where it is installed.
  external: ["typescript", "ink", "react"],
  logLevel: "warning",
});
fs.writeFileSync(path.join(pkg, "dist/package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);

fs.cpSync(path.join(packages, "compiler/lib"), path.join(pkg, "lib"), { recursive: true });
for (const dir of ["cpp", "js", "native"]) {
  fs.cpSync(path.join(packages, "runtime", dir), path.join(pkg, "runtime", dir), { recursive: true });
}
// lucent bench builds a desktop JSI host around the runtime with it.
fs.cpSync(path.join(packages, "runtime/test/jsi/harness.cpp"), path.join(pkg, "runtime/test/jsi/harness.cpp"));
