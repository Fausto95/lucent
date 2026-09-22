/** Execute SDK enum bindings on both native toolchains. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, type LibraryModule } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";

/** A hand-written stand-in for an SDK enum, so the check needs no platform framework. */
const SWIFT_SDK = `enum SampleQuality: Int { case low = 1, high = 2 }`;
const KOTLIN_SDK = `enum class SampleQuality(val level: Int) { LOW(1), HIGH(2) }`;

const library: LibraryModule = {
  schemaVersion: 1,
  source: `export type Quality = "low" | "high";
export declare function levelOf(quality:Quality):number;
export declare function best():Quality;`,
  enums: {
    Quality: {
      cases: ["low", "high"],
      swift: { type: "SampleQuality", values: { low: ".low", high: ".high" } },
      kotlin: { type: "SampleQuality", values: { low: "SampleQuality.LOW", high: "SampleQuality.HIGH" } },
    },
  },
  bindings: {
    levelOf: { swift: ["return Double(quality.rawValue)"], kotlin: ["return quality.level.toDouble()"] },
    best: { swift: ["return .high"], kotlin: ["return SampleQuality.HIGH"] },
  },
};

const source = `import {levelOf, best} from '@lucent-lang/sdk/quality';
import type {Quality} from '@lucent-lang/sdk/quality';
export function lowLevel():number{return levelOf("low");}
export function chosen():Quality{return best();}
export function preferred(quality:Quality):number{return levelOf(quality);}
export function isBest():boolean{return best() === "high";}`;

const result = compile(source, { fileName: "quality.lucent.ts", libraries: { "@lucent-lang/sdk/quality": library } });
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const dir = mkdtempSync(join(tmpdir(), "lucent-enums-"));

const swift = `typealias ArrayBuffer = [UInt8]
${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}
${SWIFT_SDK}
${generateSwift(module).code}
precondition(try lowLevel() == 1)
precondition(try preferred(quality: LucentEnum_Quality.fromLucent("high")) == 2)
precondition(try LucentEnum_Quality.toLucent(chosen()) == "high")
precondition(try isBest())
do { _ = try LucentEnum_Quality.fromLucent("ultra"); fatalError("Unknown case accepted") }
catch let error as LucentError { precondition(error.code == "INVALID_ENUM_CASE") }
print("swift: SDK enum cases, boundary conversion and unknown-case rejection passed")
`;
writeFileSync(join(dir, "main.swift"), swift.replaceAll("precondition(try ", "precondition(try! "));
execFileSync("swiftc", ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "test")], {
  stdio: "pipe",
});
process.stdout.write(execFileSync(join(dir, "test")));

const kotlin = `typealias ArrayBuffer = ByteArray
${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}
${KOTLIN_SDK}
${generateKotlin(module).code}
fun main() {
 check(lowLevel() == 1.0)
 check(preferred(LucentEnum_Quality.fromLucent("high")) == 2.0)
 check(LucentEnum_Quality.toLucent(chosen()) == "high")
 check(isBest())
 try { LucentEnum_Quality.fromLucent("ultra"); error("Unknown case accepted") }
 catch (error: LucentError) { check(error.code == "INVALID_ENUM_CASE") }
 println("kotlin: SDK enum cases, boundary conversion and unknown-case rejection passed")
}
`;
writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], { stdio: "pipe" });
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")]));
