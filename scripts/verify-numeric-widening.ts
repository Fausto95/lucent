/** Compile and execute every permitted SDK numeric widening at its range boundaries. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, type LibraryModule } from "../packages/compiler/src/index.ts";
import { NUMERIC_WIDENINGS } from "../packages/compiler/src/types/numeric-widening.ts";
import { SIZED_NUMERIC_TYPES } from "../packages/compiler/src/types/native-type.ts";
import { generateSwift } from "../packages/backend-swift/src/index.ts";
import { swiftType } from "../packages/backend-swift/src/types.ts";
import { generateKotlin } from "../packages/backend-kotlin/src/index.ts";
import { kotlinType } from "../packages/backend-kotlin/src/types.ts";
const pairs = Object.entries(NUMERIC_WIDENINGS).flatMap(([source, targets]) =>
  targets.map((target) => ({ source, target })),
);
const names = Object.keys(SIZED_NUMERIC_TYPES);
const imports = `import type {${names.join(",")}} from "@lucent-lang/types";`;
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
const dir = mkdtempSync(join(tmpdir(), "lucent-widening-"));
const swiftChecks = pairs.flatMap((p, i) => {
  const type = swiftType(SIZED_NUMERIC_TYPES[p.source]!);
  const limits =
    p.source === "float32"
      ? [`-${type}.greatestFiniteMagnitude`, `${type}.leastNormalMagnitude`, `${type}.greatestFiniteMagnitude`]
      : [`${type}.min`, `${type}.max`];
  return limits.map((value) => `precondition(Double(try! widen${i}(value: ${value})) == Double(${value}))`);
});
writeFileSync(
  join(dir, "main.swift"),
  generateSwift(result.module).code +
    "\n" +
    swiftChecks.join("\n") +
    '\nprint("swift: all lossless SDK widening boundaries passed")\n',
);
execFileSync("swiftc", ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "test")], {
  stdio: "pipe",
});
process.stdout.write(execFileSync(join(dir, "test")));
const kotlinChecks = pairs.flatMap((p, i) => {
  const type = kotlinType(SIZED_NUMERIC_TYPES[p.source]!);
  const limits =
    p.source === "float32"
      ? [`-${type}.MAX_VALUE`, `${type}.MIN_VALUE`, `${type}.MAX_VALUE`]
      : [`${type}.MIN_VALUE`, `${type}.MAX_VALUE`];
  return limits.map((value) => `check(widen${i}(${value}).toDouble() == (${value}).toDouble())`);
});
writeFileSync(
  join(dir, "Main.kt"),
  generateKotlin(result.module).code +
    "\nfun main() {\n" +
    kotlinChecks.join("\n") +
    '\nprintln("kotlin: all lossless SDK widening boundaries passed")\n}\n',
);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "test.jar")], { stdio: "pipe" });
process.stdout.write(execFileSync("java", ["-jar", join(dir, "test.jar")]));
