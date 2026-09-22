/**
 * Execute the cooperative cancellation primitive on both native toolchains.
 * Harness runners live under scripts/native/verify-cancellation/.
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
  `import {CancellationSource} from '@lucent-lang/core/cancellation';
export function make():CancellationSource{return new CancellationSource();}
export function cancel(source:CancellationSource):void{source.cancel();}
export function checkpoint(source:CancellationSource):boolean{source.throwIfCancelled();return source.cancelled;}
export function child(source:CancellationSource):CancellationSource{return source.scope();}
export function complete(source:CancellationSource):boolean{return source.finish();}`,
  { fileName: "cancellation.lucent.ts" },
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
  fillVerifyHarness(readNativeTemplate("verify-cancellation", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: packageSources(ir, "swift"),
    generated: generateSwift(ir).code,
  }),
  "lucent-cancellation-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-cancellation", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: packageSources(ir, "kotlin"),
    generated: generateKotlin(ir).code,
  }),
  "lucent-cancellation-",
);
