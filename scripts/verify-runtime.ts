/**
 * Execute generated SDK bindings and error envelopes on both native toolchains.
 * Harness bodies are Doc trees from `@lucent-lang/codegen`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { block, sections } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { normalizeError } from "../packages/runtime/src/index.ts";
import { extractJavaSignatures, generateBindingLibrary } from "../packages/sdk/src/index.ts";
import { createNativeHarnessDir, renderKotlinVerifyProgram, renderSwiftVerifyProgram } from "./lib/native-harness.ts";

const javaSignatures = execFileSync("javap", ["-public", "java.lang.Math"], { encoding: "utf8" });
const library = generateBindingLibrary(extractJavaSignatures(javaSignatures)).library;
const source =
  'import {hypot,abs} from "@lucent-lang/sdk/math"; import {Platform} from "@lucent-lang/core/platform"; export function length():number {if(Platform.OS === "android"){return hypot(abs(-3),4);}return 0;}';
const result = compile(source, { fileName: "sdk.lucent.ts", libraries: { "@lucent-lang/sdk/math": library } });
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-sdk-verify-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() throws {", [
      "let result = try length()",
      "precondition(result == 0)",
      'print(lucentErrorWire("TEST", "Line\\n🌍", ["attempt": 2, "detail": NSNull(), "nonFinite": Double.infinity]))',
    ]),
  ]),
]);
writeFileSync(paths.swiftFile, renderSwiftVerifyProgram(module, swiftHarness));
execFileSync(
  "swiftc",
  [
    "-parse-as-library",
    "-module-cache-path",
    join(paths.dir, "cache"),
    paths.swiftFile,
    "-o",
    join(paths.dir, "swift-test"),
  ],
  { stdio: "pipe" },
);
const swiftResult = execFileSync(join(paths.dir, "swift-test"), [], { encoding: "utf8" }).trim();

const kotlinHarness = sections([
  block("fun main() {", [
    "check(length() == 5.0)",
    'println(lucentErrorWire("TEST", "Line\\n🌍", mapOf("attempt" to 2, "detail" to null, "nonFinite" to Double.POSITIVE_INFINITY)))',
  ]),
]);
writeFileSync(paths.kotlinFile, renderKotlinVerifyProgram(module, kotlinHarness));
execFileSync("kotlinc", [paths.kotlinFile, "-include-runtime", "-d", join(paths.dir, "main.jar")], { stdio: "pipe" });
const kotlinResult = execFileSync("java", ["-jar", join(paths.dir, "main.jar")], { encoding: "utf8" }).trim();

for (const [name, wire] of [
  ["swift", swiftResult],
  ["kotlin", kotlinResult],
] as const) {
  const error = normalizeError(new Error(wire));
  if (
    error.code !== "TEST" ||
    error.message !== "Line\n🌍" ||
    error.metadata.attempt !== 2 ||
    error.metadata.detail !== null ||
    error.metadata.nonFinite !== null
  )
    throw new Error(name + " failed: " + JSON.stringify(error));
  console.log(name + ": extracted SDK guard + native error envelope roundtrip passed");
}
