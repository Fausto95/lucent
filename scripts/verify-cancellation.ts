/** Execute the cooperative cancellation primitive on both native toolchains. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
const result = compile(
  `import {CancellationSource} from '@lucent-lang/core/cancellation';
export function make():CancellationSource{return new CancellationSource();}
export function cancel(source:CancellationSource):void{source.cancel();}
export function checkpoint(source:CancellationSource):boolean{source.throwIfCancelled();return source.cancelled;}`,
  { fileName: "cancellation.lucent.ts" },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;
const dir = mkdtempSync(join(tmpdir(), "lucent-cancellation-"));
const packages = Object.values(module.nativePackages ?? {});
const swift = `typealias ArrayBuffer = [UInt8]
${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}
${packages.flatMap((p) => Object.values(p.swift ?? {})).join("\n")}
${generateSwift(module).code}
let source = try make()
let initial = try checkpoint(source: source)
precondition(!initial)
DispatchQueue.concurrentPerform(iterations: 1000) { _ in try! cancel(source: source) }
do { _ = try checkpoint(source: source); fatalError("Cancellation was ignored") } catch let error as LucentError { precondition(error.code == "CANCELLED") }
try cancel(source: source)
print("swift: cooperative cancellation, typed errors and concurrent cancellation passed")
`;
writeFileSync(join(dir, "main.swift"), swift);
execFileSync(
  "swiftc",
  ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "swift-test")],
  { stdio: "pipe" },
);
process.stdout.write(execFileSync(join(dir, "swift-test")));
const kotlin = `typealias ArrayBuffer = ByteArray
${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}
${packages
  .flatMap((p) => Object.values(p.kotlin ?? {}))
  .join("\n")
  .replace(/^package .*\n/gm, "")}
${generateKotlin(module).code}
fun main() {
 val source=make()
 check(!checkpoint(source))
 val workers=(0 until 8).map { kotlin.concurrent.thread { repeat(125) { cancel(source) } } }
 workers.forEach { it.join() }
 try { checkpoint(source); error("Cancellation was ignored") } catch (error:LucentError) { check(error.code == "CANCELLED") }
 cancel(source)
 println("kotlin: cooperative cancellation, typed errors and concurrent cancellation passed")
}
`;
writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], { stdio: "pipe" });
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")]));
