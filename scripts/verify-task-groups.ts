/**
 * Compile task-group bindings and verify sibling cancellation + primary-error
 * rethrow on Swift and Kotlin. Harness bodies are Doc trees from
 * `@lucent-lang/codegen` (see scripts/lib/native-harness.ts).
 */
import { block, sections } from "../packages/codegen/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import {
  createNativeHarnessDir,
  renderKotlinVerifyProgram,
  renderSwiftVerifyProgram,
  writeAndRunKotlin,
  writeAndRunSwift,
} from "./lib/native-harness.ts";

const result = compile(
  [
    "import {TaskGroup,NativeTask} from '@lucent-lang/core/tasks';",
    "export function make():TaskGroup{return new TaskGroup();}",
    "export function begin(group:TaskGroup):NativeTask{return group.begin();}",
    "export async function close(group:TaskGroup):Promise<void>{await group.close();}",
  ].join("\n"),
  { fileName: "task-groups.lucent.ts" },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const paths = createNativeHarnessDir("lucent-task-groups-");

const swiftHarness = sections([
  block("@main struct Runner {", [
    block("static func main() async throws {", [
      "let group = try make()",
      "let first = try begin(group: group)",
      "let second = try begin(group: group)",
      'first.fail(LucentError(code: "CHILD_FAILED", message: "primary child failed"))',
      "precondition(first.finished && second.cancelled && group.activeCount == 1)",
      "precondition(!second.finish() && second.finished && group.activeCount == 0)",
      block("do {", ["try await close(group: group)", 'fatalError("close should rethrow primary error")']),
      block("catch let error as LucentError {", ['precondition(error.code == "CHILD_FAILED")']),
      "let runGroup = LucentTaskGroup()",
      "let sibling = try runGroup.begin()",
      block("try runGroup.run {", ['throw LucentError(code: "RUN_FAILED", message: "run child failed")']),
      "while !sibling.cancelled { await Task.yield() }",
      "precondition(sibling.cancelled)",
      "precondition(!sibling.finish())",
      block("do {", ["try await runGroup.close()", 'fatalError("run close should rethrow")']),
      block("catch let error as LucentError {", ['precondition(error.code == "RUN_FAILED")']),
      'print("swift: task group sibling cancel and primary rethrow passed")',
    ]),
  ]),
]);

process.stdout.write(writeAndRunSwift(paths, renderSwiftVerifyProgram(module, swiftHarness)));

const kotlinHarness = sections([
  block("fun main() {", [
    "val group = make()",
    "val first = begin(group)",
    "val second = begin(group)",
    'first.fail(LucentError("CHILD_FAILED", "primary child failed"))',
    "check(first.finished && second.cancelled && group.activeCount == 1.0)",
    "check(!second.finish() && second.finished && group.activeCount == 0.0)",
    "var sawPrimary = false",
    block("val closing: suspend () -> Unit = {", [
      block("try {", ["close(group)", 'error("close should rethrow primary error")']),
      block("catch (error: LucentError) {", ['check(error.code == "CHILD_FAILED")', "sawPrimary = true"]),
    ]),
    block(
      "closing.startCoroutine(object: Continuation<Unit> {",
      [
        "override val context = kotlin.coroutines.EmptyCoroutineContext",
        "override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }",
      ],
      "})",
    ),
    "while (!sawPrimary) Thread.yield()",
    "val runGroup = LucentTaskGroup()",
    "val sibling = runGroup.begin()",
    block("runGroup.run {", ['throw LucentError("RUN_FAILED", "run child failed")']),
    "while (!sibling.cancelled) Thread.yield()",
    "check(sibling.cancelled)",
    "check(!sibling.finish())",
    "var sawRun = false",
    block("val runClose: suspend () -> Unit = {", [
      block("try {", ["runGroup.close()", 'error("run close should rethrow")']),
      block("catch (error: LucentError) {", ['check(error.code == "RUN_FAILED")', "sawRun = true"]),
    ]),
    block(
      "runClose.startCoroutine(object: Continuation<Unit> {",
      [
        "override val context = kotlin.coroutines.EmptyCoroutineContext",
        "override fun resumeWith(result: Result<Unit>) { result.getOrThrow() }",
      ],
      "})",
    ),
    "while (!sawRun) Thread.yield()",
    'println("kotlin: task group sibling cancel and primary rethrow passed")',
  ]),
]);

process.stdout.write(
  writeAndRunKotlin(
    paths,
    renderKotlinVerifyProgram(module, kotlinHarness, ["import kotlin.coroutines.startCoroutine"]),
  ),
);
