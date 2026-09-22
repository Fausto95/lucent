/**
 * Execute SDK enum bindings on both native toolchains.
 * Harness runners live under scripts/native/verify-enums/; the stand-in SDK
 * enum types are passed through the packages fill.
 */
import { compile, type LibraryModule } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
import {
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  readNativeTemplate,
} from "./lib/verify-harness.ts";

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
const ir = result.module;

const runtimeSwift = swiftRuntime({
  length: "return Double(buffer.count)",
  get: "return Double(buffer[Int(index)])",
});
const runtimeKotlin = kotlinRuntime({
  imports: [],
  length: "return buffer.size.toDouble()",
  get: "return buffer[index.toInt()].toDouble()",
});

compileAndRunSwift(
  fillVerifyHarness(readNativeTemplate("verify-enums", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: [SWIFT_SDK],
    generated: generateSwift(ir).code,
  }),
  "lucent-enums-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-enums", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: [KOTLIN_SDK],
    generated: generateKotlin(ir).code,
  }),
  "lucent-enums-",
);
