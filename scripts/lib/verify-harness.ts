/**
 * Compose and run Swift/Kotlin verify harnesses.
 *
 * Native SDK sources stay as real `.swift`/`.kt` files. Harness runners live
 * under `scripts/native/` with `{{token}}` holes filled by `fillNative`.
 * File assembly uses `Doc`/`sections`/`render` — never TypeScript template
 * literals that invent braces or indentation.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fillNative, render, sections, type Doc } from "../../packages/codegen/src/index.ts";
import type { IRModule } from "../../packages/compiler/src/index.ts";

const scriptsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read a hand-written harness template from `scripts/native/...`. */
export function readNativeTemplate(...segments: string[]): string {
  return readFileSync(join(scriptsRoot, "native", ...segments), "utf8");
}

/**
 * Collect package native sources from a compiled module.
 * Kotlin `{{androidPackage}}` is filled, then the package line is stripped for
 * single-file `kotlinc` harnesses.
 */
export function packageSources(
  module: IRModule,
  language: "swift" | "kotlin",
  fills: { androidPackage?: string } = {},
): string[] {
  const packages = Object.values(module.nativePackages ?? {});
  return packages.flatMap((pack) => {
    const sources = language === "swift" ? pack.swift : pack.kotlin;
    return Object.values(sources ?? {}).map((source) => {
      let text = source;
      if (language === "kotlin") {
        text = fillNative(text, { androidPackage: fills.androidPackage ?? "lucent.verify" });
        text = text.replace(/^package .+\n(?:\n)?/, "");
      }
      return text.trimEnd();
    });
  });
}

/** Join prelude pieces with structural blank lines (codegen `sections`/`render`). */
export function assembleSections(parts: readonly Doc[]): string {
  return render(sections(parts.map((part) => (typeof part === "string" ? part.trimEnd() : part))));
}

/**
 * Fill a harness template that declares `{{runtime}}`, `{{packages}}`, and
 * `{{generated}}` tokens. The template body itself is hand-written native code.
 */
export function fillVerifyHarness(
  template: string,
  values: { runtime: string; packages: readonly string[]; generated: string },
): string {
  return fillNative(template, {
    runtime: values.runtime.trimEnd(),
    packages: values.packages.join("\n\n"),
    generated: values.generated.trimEnd(),
  });
}

/** Hoist Kotlin import lines to the top of a single-file harness. */
export function hoistKotlinImports(source: string, extra: readonly string[] = []): string {
  const found = [...source.matchAll(/^import .+$/gm)].map((m) => m[0]!);
  const imports = [...new Set([...extra, ...found])];
  const body = source.replace(/^import .+\n/gm, "");
  return assembleSections([imports.join("\n"), body.trimStart()]);
}

export function compileAndRunSwift(source: string, prefix = "lucent-verify-"): void {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "main.swift"), source);
  execFileSync(
    "swiftc",
    [
      "-parse-as-library",
      "-module-cache-path",
      join(dir, "cache"),
      join(dir, "main.swift"),
      "-o",
      join(dir, "swift-test"),
    ],
    { stdio: "pipe", timeout: 120000 },
  );
  process.stdout.write(execFileSync(join(dir, "swift-test"), { timeout: 30000 }));
}

export function compileAndRunKotlin(source: string, prefix = "lucent-verify-"): void {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const prepared = hoistKotlinImports(source, ["import kotlin.coroutines.startCoroutine"]);
  writeFileSync(join(dir, "Main.kt"), prepared);
  execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], {
    stdio: "pipe",
    timeout: 120000,
  });
  process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")], { timeout: 30000 }));
}
