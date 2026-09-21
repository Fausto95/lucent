/** Execute generated SDK bindings and error envelopes on both native toolchains. */
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
import { normalizeError } from "../packages/runtime/src/index.ts";
import { extractJavaSignatures, generateBindingLibrary } from "../packages/sdk/src/index.ts";
const javaSignatures = execFileSync("javap", ["-public", "java.lang.Math"], { encoding: "utf8" });
const library = generateBindingLibrary(extractJavaSignatures(javaSignatures)).library;
const source =
  'import {hypot} from "@lucent-lang/sdk/math"; import {Platform} from "@lucent-lang/platform"; export function length():number {if(Platform.OS === "android"){return hypot(3,4);}return 0;}';
const result = compile(source, { fileName: "sdk.lucent.ts", libraries: { "@lucent-lang/sdk/math": library } });
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const dir = mkdtempSync(join(tmpdir(), "lucent-sdk-verify-"));
const swift =
  "typealias ArrayBuffer = [UInt8]\n" +
  swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" }) +
  "\n" +
  generateSwift(result.module).code +
  '\nlet result = try length(); precondition(result == 0)\nprint(lucentErrorWire("TEST", "Line\\n🌍", ["attempt": 2, "detail": NSNull(), "nonFinite": Double.infinity]))\n';
writeFileSync(join(dir, "main.swift"), swift);
execFileSync(
  "swiftc",
  ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "swift-test")],
  { stdio: "pipe" },
);
const swiftResult = execFileSync(join(dir, "swift-test"), [], { encoding: "utf8" }).trim();
const kotlin =
  "typealias ArrayBuffer = ByteArray\n" +
  kotlinRuntime({
    imports: [],
    length: "return buffer.size.toDouble()",
    get: "return buffer[index.toInt()].toDouble()",
  }) +
  "\n" +
  generateKotlin(result.module).code +
  '\nfun main() { check(length() == 5.0); println(lucentErrorWire("TEST", "Line\\n🌍", mapOf("attempt" to 2, "detail" to null, "nonFinite" to Double.POSITIVE_INFINITY))) }\n';
writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], { stdio: "pipe" });
const kotlinResult = execFileSync("java", ["-jar", join(dir, "main.jar")], { encoding: "utf8" }).trim();
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
