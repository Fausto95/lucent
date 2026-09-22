/**
 * Compile resource bindings and race close against in-flight leases on both toolchains.
 *
 * Harness runners live under scripts/native/verify-resources/ and are filled via
 * @lucent-lang/codegen (no TypeScript template literals for native assembly).
 */
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
import {
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  packageSources,
  readNativeTemplate,
} from "./lib/verify-harness.ts";

const result = compile(
  `import {NativeResource} from '@lucent-lang/core/resources';
export function make():NativeResource{return new NativeResource();}
export function begin(resource:NativeResource):void{resource.beginOperation();}
export function end(resource:NativeResource):void{resource.endOperation();}
export async function close(resource:NativeResource):Promise<void>{await resource.close();}`,
  { fileName: "resources.lucent.ts" },
);
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
  fillVerifyHarness(readNativeTemplate("verify-resources", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: packageSources(ir, "swift"),
    generated: generateSwift(ir).code,
  }),
  "lucent-resources-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-resources", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: packageSources(ir, "kotlin"),
    generated: generateKotlin(ir).code,
  }),
  "lucent-resources-",
);
