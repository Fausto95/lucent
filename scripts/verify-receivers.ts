/**
 * Execute class receiver mutation on both toolchains.
 *
 * A Lucent class is a reference: a caller observes what a method did to it.
 * Nothing else here executes that. The fixtures only prove the generated code
 * compiles, and it compiles either way — passing the receiver through and
 * copying it into a local both work, because copying a class reference still
 * points at the same instance.
 *
 * So this pins the contract rather than one implementation of it. It fails if
 * a Lucent class ever stops being a reference on either platform, or if
 * lowering starts rebuilding the receiver instead of forwarding it. The
 * opposite mistake — treating a value struct as a reference — is caught at
 * compile time instead, by `bumpCount` in the kitchen fixture.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";

const result = compile(
  `export class Counter {
  value: number = 0;
  constructor(initial: number) { this.value = initial; }
  increment(delta: number): number { this.value += delta; return this.value; }
}
export function bump(counter: Counter): number { return counter.increment(1); }
export function reset(counter: Counter): void { counter.value = 0; }`,
  { fileName: "receivers.lucent.ts" },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const module = result.module;

// Class operations carry a content hash in their name; take them from the IR.
const op = (suffix: string): string => {
  const found = module.functions.find((f) => f.name.endsWith(suffix));
  if (!found) throw new Error(`receivers: no class operation ${suffix}`);
  return found.name;
};
const create = op("__create");
const getValue = op("__get_value");
const setValue = op("__set_value");
const increment = op("__method_increment");

const dir = mkdtempSync(join(tmpdir(), "lucent-receivers-"));

const swift = `typealias ArrayBuffer = [UInt8]
${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}
${generateSwift(module).code}
let counter = try ${create}(initial: 10)
// Two bindings, one instance. Every mutation below must be seen by both.
let alias = counter

let afterIncrement = try ${increment}(lucentSelf: counter, delta: 5)
precondition(afterIncrement == 15, "method returned a stale value")
let seenByAlias = try ${getValue}(lucentSelf: alias)
precondition(seenByAlias == 15, "method mutated a copy")

try ${setValue}(lucentSelf: alias, value: 99)
let seenByCounter = try ${getValue}(lucentSelf: counter)
precondition(seenByCounter == 99, "setter mutated a copy")

let bumped = try bump(counter: alias)
precondition(bumped == 100, "free function returned a stale value")
// precondition takes a non-throwing autoclosure, so each read is bound first.
let afterBump = try ${getValue}(lucentSelf: counter)
precondition(afterBump == 100, "free function mutated a copy")

try reset(counter: counter)
let afterReset = try ${getValue}(lucentSelf: alias)
precondition(afterReset == 0, "void free function mutated a copy")

// Distinct instances stay distinct.
let other = try ${create}(initial: 7)
try ${setValue}(lucentSelf: other, value: 42)
let untouched = try ${getValue}(lucentSelf: counter)
let ownState = try ${getValue}(lucentSelf: other)
precondition(untouched == 0, "instances share state")
precondition(ownState == 42, "instance lost its own state")
print("swift: class receivers are shared, not copied")
`;

writeFileSync(join(dir, "main.swift"), swift);
execFileSync(
  "swiftc",
  ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "swift-test")],
  {
    stdio: "pipe",
    timeout: 120000,
  },
);
process.stdout.write(execFileSync(join(dir, "swift-test"), { timeout: 30000 }));

const kotlin = `typealias ArrayBuffer = ByteArray
${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}
${generateKotlin(module).code}
fun main() {
 val counter = ${create}(10.0)
 val alias = counter

 check(${increment}(counter, 5.0) == 15.0) { "method returned a stale value" }
 check(${getValue}(alias) == 15.0) { "method mutated a copy" }

 ${setValue}(alias, 99.0)
 check(${getValue}(counter) == 99.0) { "setter mutated a copy" }

 check(bump(alias) == 100.0) { "free function returned a stale value" }
 check(${getValue}(counter) == 100.0) { "free function mutated a copy" }

 reset(counter)
 check(${getValue}(alias) == 0.0) { "void free function mutated a copy" }

 val other = ${create}(7.0)
 ${setValue}(other, 42.0)
 check(${getValue}(counter) == 0.0) { "instances share state" }
 check(${getValue}(other) == 42.0) { "instance lost its own state" }
 println("kotlin: class receivers are shared, not copied")
}
`;

writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], {
  stdio: "pipe",
  timeout: 120000,
});
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")], { timeout: 30000 }));
