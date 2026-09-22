/**
 * Compile and execute every permitted SDK numeric widening at its range boundaries.
 * Harness bodies are Doc trees from `@lucent-lang/codegen`.
 */
import { block, render, sections } from "../packages/codegen/src/index.ts";
import { compile, type LibraryModule } from "../packages/compiler/src/index.ts";
import { NUMERIC_WIDENINGS } from "../packages/compiler/src/types/numeric-widening.ts";
import { SIZED_NUMERIC_TYPES } from "../packages/compiler/src/types/native-type.ts";
import { generateSwift } from "../packages/backend-swift/src/index.ts";
import { swiftType } from "../packages/backend-swift/src/types.ts";
import { generateKotlin } from "../packages/backend-kotlin/src/index.ts";
import { kotlinType } from "../packages/backend-kotlin/src/types.ts";
import { createNativeHarnessDir, writeAndRunKotlin, writeAndRunSwift } from "./lib/native-harness.ts";

const pairs = Object.entries(NUMERIC_WIDENINGS).flatMap(([source, targets]) =>
  targets.map((target) => ({ source, target })),
);
const names = Object.keys(SIZED_NUMERIC_TYPES);
const imports = `import type {${names.join(",")}} from "@lucent-lang/core/types";`;
const targets = [...new Set(pairs.map((p) => p.target))];
const library: LibraryModule = {
  source: imports + targets.map((t) => `export declare function accept_${t}(value:${t}):${t};`).join("\n"),
  bindings: Object.fromEntries(
    targets.map((t) => [`accept_${t}`, { swift: ["return value"], kotlin: ["return value"] }]),
  ),
};
const source =
  imports +
  `import {${targets.map((t) => `accept_${t}`).join(",")}} from "@sdk/numeric";` +
  pairs
    .map((p, i) => `export function widen${i}(value:${p.source}):${p.target}{return accept_${p.target}(value);}`)
    .join("\n");
const result = compile(source, { fileName: "widening.lucent.ts", libraries: { "@sdk/numeric": library } });
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const paths = createNativeHarnessDir("lucent-widening-");

const swiftChecks = pairs.flatMap((p, i) => {
  const type = swiftType(SIZED_NUMERIC_TYPES[p.source]!);
  const limits =
    p.source === "float32"
      ? [`-${type}.greatestFiniteMagnitude`, `${type}.leastNormalMagnitude`, `${type}.greatestFiniteMagnitude`]
      : [`${type}.min`, `${type}.max`];
  return limits.map((value) => `precondition(Double(try! widen${i}(value: ${value})) == Double(${value}))`);
});
const swiftSource = render(
  sections([
    generateSwift(result.module).code,
    block("@main struct Runner {", [
      block("static func main() {", [...swiftChecks, 'print("swift: all lossless SDK widening boundaries passed")']),
    ]),
  ]),
);
process.stdout.write(writeAndRunSwift(paths, swiftSource));

const kotlinChecks = pairs.flatMap((p, i) => {
  const type = kotlinType(SIZED_NUMERIC_TYPES[p.source]!);
  const limits =
    p.source === "float32"
      ? [`-${type}.MAX_VALUE`, `${type}.MIN_VALUE`, `${type}.MAX_VALUE`]
      : [`${type}.MIN_VALUE`, `${type}.MAX_VALUE`];
  return limits.map((value) => `check(widen${i}(${value}).toDouble() == (${value}).toDouble())`);
});
const kotlinSource = render(
  sections([
    generateKotlin(result.module).code,
    block("fun main() {", [...kotlinChecks, 'println("kotlin: all lossless SDK widening boundaries passed")']),
  ]),
);
process.stdout.write(writeAndRunKotlin(paths, kotlinSource));
