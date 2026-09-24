/**
 * Builds @lucent-lang/lucent for publishing: bundles the CLI and the
 * compiler (with bindgen) into dist/, and copies the files the compiler
 * reads at run time next to it, where the bundled code looks for them:
 * lib/ (declarations) and runtime/ (C++ runtime, native templates, the JS
 * loader).
 */
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite-plus";
import { sourcesHash } from "../bindgen/src/provider.ts";

const packages = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  pack: {
    // The TypeScript plugin and the CLI share the compiler's code, in shared chunks.
    entry: { cli: "src/cli/main.ts", compiler: "../compiler/src/index.ts" },
    outDir: "dist",
    format: "esm",
    platform: "node",
    target: "node22",
    // dist/package.json makes .js ESM; bin/, metro/ and ts-plugin/ load cli.js and compiler.js.
    outExtensions: () => ({ js: ".js" }),
    sourcemap: false,
    // Legal and annotation comments stay; JSDoc would add about 40 kB.
    outputOptions: { comments: { jsdoc: false } },
    dts: false,
    clean: ["dist", "lib", "runtime"],
    // SDK caches are keyed on bindgen's code, not on the whole bundle.
    define: { __LUCENT_EXTRACTOR__: JSON.stringify(sourcesHash(path.join(packages, "bindgen/src"))) },
    deps: {
      // The published package's dependencies, resolved from where it is installed.
      neverBundle: ["typescript", "ink", "react"],
      // A dependency, but small enough that bundling saves the CLI a resolve at start-up.
      alwaysBundle: ["picocolors"],
    },
    copy: [
      { from: "../compiler/lib", to: "." },
      { from: ["../runtime/cpp", "../runtime/js", "../runtime/native"], to: "runtime" },
      // lucent bench builds a desktop JSI host around the runtime with it.
      { from: "../runtime/test/jsi/harness.cpp", to: "runtime/test/jsi" },
    ],
    hooks: {
      "build:done": () => fs.writeFileSync(path.join(import.meta.dirname, "dist/package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`),
    },
  },
  run: {
    tasks: {
      build: {
        command: "vp pack",
        // The build clears and rewrites these, so reading them isn't an input.
        input: [{ auto: true }, "!dist/**", "!lib/**", "!runtime/**"],
        output: ["dist/**", "lib/**", "runtime/**"],
      },
    },
  },
});
