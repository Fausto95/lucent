/**
 * Compile actual task bindings and execute cancellation/completion races on both
 * toolchains. Harness runners live under scripts/native/verify-task-scopes/.
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
  `import {TaskScope,NativeTask} from '@lucent-lang/core/tasks';
export function make():TaskScope{return new TaskScope();}
export function begin(scope:TaskScope):NativeTask{return scope.begin();}
export async function close(scope:TaskScope):Promise<void>{await scope.close();}`,
  { fileName: "tasks.lucent.ts" },
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
  fillVerifyHarness(readNativeTemplate("verify-task-scopes", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: packageSources(ir, "swift"),
    generated: generateSwift(ir).code,
  }),
  "lucent-tasks-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-task-scopes", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: packageSources(ir, "kotlin"),
    generated: generateKotlin(ir).code,
  }),
  "lucent-tasks-",
);
