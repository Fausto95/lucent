/**
 * Shared verify harness emission via `@lucent-lang/codegen`.
 *
 * Compile a Lucent module, then pass a Doc-built Swift/Kotlin runner body.
 * Runtime preludes, embedded native packages, and generated bindings are
 * composed with `sections` / `render` — never assembled with template literals.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { render, sections, type Doc } from "../../packages/codegen/src/index.ts";
import { generateSwift, swiftRuntime } from "../../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../../packages/backend-kotlin/src/index.ts";
import type { IRModule } from "../../packages/compiler/src/ir/types.ts";

export type NativeVerifyModule = IRModule;

const defaultSwiftBytes = {
  length: "return Double(buffer.count)",
  get: "return Double(buffer[Int(index)])",
} as const;

const defaultKotlinBytes = {
  imports: [] as string[],
  length: "return buffer.size.toDouble()",
  get: "return buffer[index.toInt()].toDouble()",
} as const;

function nativePackageSources(module: IRModule, lang: "swift" | "kotlin"): string[] {
  return Object.values(module.nativePackages ?? {}).flatMap((pkg) =>
    Object.values((lang === "swift" ? pkg.swift : pkg.kotlin) ?? {}),
  );
}

/** Render a Swift verify program: ArrayBuffer alias, runtime, packages, generated code, harness. */
export function renderSwiftVerifyProgram(module: IRModule, harness: Doc): string {
  return render(
    sections([
      "typealias ArrayBuffer = [UInt8]",
      swiftRuntime(defaultSwiftBytes),
      ...nativePackageSources(module, "swift"),
      generateSwift(module).code,
      harness,
    ]),
  );
}

/** Render a Kotlin verify program; hoists imports to the file head. */
export function renderKotlinVerifyProgram(
  module: IRModule,
  harness: Doc,
  extraImports: readonly string[] = [],
): string {
  const kotlinPackages = nativePackageSources(module, "kotlin").map((src) => src.replace(/^package .*\n/gm, ""));
  const body = render(
    sections([
      "typealias ArrayBuffer = ByteArray",
      kotlinRuntime(defaultKotlinBytes),
      ...kotlinPackages,
      generateKotlin(module).code,
      harness,
    ]),
  );
  const imports = [...extraImports, ...Array.from(body.matchAll(/^import .+$/gm), (m) => m[0])];
  const unique = [...new Set(imports)];
  return render(sections([unique.join("\n"), body.replace(/^import .+\n/gm, "")]));
}

export interface NativeHarnessPaths {
  readonly dir: string;
  readonly swiftFile: string;
  readonly kotlinFile: string;
}

export function createNativeHarnessDir(prefix: string): NativeHarnessPaths {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    swiftFile: join(dir, "main.swift"),
    kotlinFile: join(dir, "Main.kt"),
  };
}

export function writeAndRunSwift(paths: NativeHarnessPaths, source: string): Buffer {
  writeFileSync(paths.swiftFile, source);
  const out = join(paths.dir, "swift-test");
  execFileSync(
    "swiftc",
    ["-parse-as-library", "-module-cache-path", join(paths.dir, "cache"), paths.swiftFile, "-o", out],
    { stdio: "pipe", timeout: 120000 },
  );
  return execFileSync(out, { timeout: 30000 });
}

export function writeAndRunKotlin(paths: NativeHarnessPaths, source: string): Buffer {
  writeFileSync(paths.kotlinFile, source);
  const jar = join(paths.dir, "main.jar");
  execFileSync("kotlinc", [paths.kotlinFile, "-include-runtime", "-d", jar], {
    stdio: "pipe",
    timeout: 120000,
  });
  return execFileSync("java", ["-jar", jar], { timeout: 30000 });
}
