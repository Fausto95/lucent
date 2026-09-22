/** Compile actual task bindings and execute cancellation/completion races on both toolchains. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
const result = compile(
  `import {TaskScope,NativeTask} from '@lucent-lang/core/tasks';
export function make():TaskScope{return new TaskScope();}
export function begin(scope:TaskScope):NativeTask{return scope.begin();}
export async function close(scope:TaskScope):Promise<void>{await scope.close();}`,
  { fileName: "tasks.lucent.ts" },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const packages = Object.values(module.nativePackages ?? {});
const dir = mkdtempSync(join(tmpdir(), "lucent-tasks-"));
const swift = `typealias ArrayBuffer = [UInt8]
${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}
${packages.flatMap((p) => Object.values(p.swift ?? {})).join("\n")}
${generateSwift(module).code}
final class Counter: @unchecked Sendable {
 private let lock = NSLock()
 private var count = 0
 func increment() { lock.lock(); count += 1; lock.unlock() }
 var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}
@main struct Runner {
 static func main() async throws {
  let scope = try make()
  let first = try begin(scope: scope), second = try begin(scope: scope)
  let completed = Counter()
  let closes = (0..<8).map { _ in Task { try await close(scope: scope); completed.increment() } }
  while !scope.closing { await Task.yield() }
  precondition(first.cancelled && second.cancelled && scope.activeCount == 2)
  precondition(completed.value == 0)
  do { _ = try scope.begin(); fatalError("accepted closed scope") } catch let error as LucentError { precondition(error.code == "CLOSED_SCOPE") }
  do { try first.throwIfCancelled(); fatalError("ignored cancellation") } catch let error as LucentError { precondition(error.code == "CANCELLED") }
  precondition(!first.finish() && first.finished && scope.activeCount == 1)
  precondition(completed.value == 0)
  precondition(!second.finish())
  for pending in closes { try await pending.value }
  precondition(completed.value == 8 && scope.activeCount == 0)
  await scope.close()
  precondition(!first.finish())
  let successScope = try make(), successes = Counter()
  let success = try successScope.begin()
  DispatchQueue.concurrentPerform(iterations: 1000) { _ in if success.finish() { successes.increment() } }
  precondition(successes.value == 1 && successScope.activeCount == 0)
  success.cancel()
  precondition(!success.cancelled && success.finished)
  await successScope.close()
  for _ in 0..<100 {
   let racingScope = LucentTaskScope(), accepted = Counter()
   let racing = try racingScope.begin()
   DispatchQueue.concurrentPerform(iterations: 2) { index in
    if index == 0 { racing.cancel() } else if racing.finish() { accepted.increment() }
   }
   precondition(racing.finished && racingScope.activeCount == 0)
   precondition(accepted.value == (racing.cancelled ? 0 : 1))
   await racingScope.close()
  }
  print("swift: task quiescence, concurrent completion and repeated close passed")
 }
}
`;
writeFileSync(join(dir, "main.swift"), swift);
execFileSync(
  "swiftc",
  [
    "-parse-as-library",
    "-module-cache-path",
    join(dir, "cache"),
    join(dir, "main.swift"),
    "-o",
    join(dir, "swift-test"),
  ],
  { stdio: "pipe", timeout: 120000 },
);
process.stdout.write(execFileSync(join(dir, "swift-test"), { timeout: 30000 }));
const kotlinBody = `typealias ArrayBuffer = ByteArray
${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}
${packages
  .flatMap((p) => Object.values(p.kotlin ?? {}))
  .join("\n")
  .replace(/^package .*\n/gm, "")}
${generateKotlin(module).code}
fun main() {
 val scope = make()
 val first = begin(scope); val second = begin(scope)
 val completed = java.util.concurrent.atomic.AtomicInteger()
 repeat(8) {
  val closing: suspend () -> Unit = { close(scope) }
  closing.startCoroutine(object: Continuation<Unit> {
   override val context = kotlin.coroutines.EmptyCoroutineContext
   override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); completed.incrementAndGet() }
  })
 }
 check(scope.closing && first.cancelled && second.cancelled && scope.activeCount == 2.0)
 check(completed.get() == 0)
 try { scope.begin(); error("accepted closed scope") } catch(error:LucentError) { check(error.code == "CLOSED_SCOPE") }
 try { first.throwIfCancelled(); error("ignored cancellation") } catch(error:LucentError) { check(error.code == "CANCELLED") }
 check(!first.finish() && first.finished && scope.activeCount == 1.0)
 check(completed.get() == 0)
 check(!second.finish())
 check(completed.get() == 8 && scope.activeCount == 0.0)
 check(!first.finish())
 val successScope = make(); val success = successScope.begin()
 val successes = java.util.concurrent.atomic.AtomicInteger()
 val workers = (0 until 8).map { kotlin.concurrent.thread { repeat(125) { if(success.finish()) successes.incrementAndGet() } } }
 workers.forEach { it.join() }
 check(successes.get() == 1 && successScope.activeCount == 0.0)
 success.cancel()
 check(!success.cancelled && success.finished)
 repeat(100) {
  val racingScope = LucentTaskScope(); val racing = racingScope.begin()
  val accepted = java.util.concurrent.atomic.AtomicInteger()
  val cancel = kotlin.concurrent.thread { racing.cancel() }
  val finish = kotlin.concurrent.thread { if(racing.finish()) accepted.incrementAndGet() }
  cancel.join(); finish.join()
  check(racing.finished && racingScope.activeCount == 0.0)
  check(accepted.get() == if(racing.cancelled) 0 else 1)
 }
 val again: suspend () -> Unit = { scope.close() }
 again.startCoroutine(object: Continuation<Unit> {
  override val context = kotlin.coroutines.EmptyCoroutineContext
  override fun resumeWith(result: Result<Unit>) { result.getOrThrow(); completed.incrementAndGet() }
 })
 check(completed.get() == 9)
 println("kotlin: task quiescence, concurrent completion and repeated close passed")
}
`;
// Runtime and generated support each declare imports; Kotlin requires all imports first.
const imports = ["import kotlin.coroutines.startCoroutine", ...kotlinBody.matchAll(/^import .+$/gm)].map((v) =>
  typeof v === "string" ? v : v[0],
);
writeFileSync(join(dir, "Main.kt"), [...new Set(imports)].join("\n") + "\n" + kotlinBody.replace(/^import .+\n/gm, ""));
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], {
  stdio: "pipe",
  timeout: 120000,
});
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")], { timeout: 30000 }));
