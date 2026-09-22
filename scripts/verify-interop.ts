/** Execute real SDK instances and compiled callbacks on both native toolchains. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { compile, type LibraryModule } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime, swiftObjectRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime, kotlinObjectRuntime } from "../packages/backend-kotlin/src/index.ts";
const library: LibraryModule = {
  source: `export type MutableText={length:number};
export declare function MutableText__create(text:string):MutableText;
export declare function MutableText__get_length(lucentSelf:MutableText):number;
export declare function MutableText__method_append(lucentSelf:MutableText,text:string):void;`,
  references: {
    MutableText: { swift: "NSMutableString", swiftImports: ["Foundation"], kotlin: "java.lang.StringBuilder" },
  },
  bindings: {
    MutableText__create: {
      swift: ["return NSMutableString(string: text)"],
      kotlin: ["return java.lang.StringBuilder(text)"],
    },
    MutableText__get_length: {
      swift: ["return Double(lucentSelf.length)"],
      kotlin: ["return lucentSelf.length.toDouble()"],
    },
    MutableText__method_append: { swift: ["lucentSelf.append(text)"], kotlin: ["lucentSelf.append(text)"] },
  },
};
const source = `import {MutableText} from '@lucent-lang/sdk/text';
import type {NativeCallback} from '@lucent-lang/types';
function twice(value:number):number{return value*2;}
function apply(value:number,callback:NativeCallback<(value:number)=>number>):number{return callback(value);}
export function compute():number{const text=new MutableText('abc');text.append('de');return apply(text.length,twice);}`;
const result = compile(source, { fileName: "interop.lucent.ts", libraries: { "@lucent-lang/sdk/text": library } });
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const dir = mkdtempSync(join(tmpdir(), "lucent-interop-"));
const swift = `typealias ArrayBuffer = [UInt8]\n${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}\n${swiftObjectRuntime}\n${generateSwift(result.module).code}
precondition(try compute() == 10)
let object = NSMutableString(string: "native")
let registry = LucentObjectRegistry.shared
let handle = registry.hold(object)
precondition(handle == registry.hold(object))
let lease = try registry.acquire(handle, NSMutableString.self)
let retained = lease.value
precondition(retained === object)
registry.release(handle)
precondition(lease.value === object)
precondition(registry.activeLeaseCount == 1)
lease.close()
lease.close()
precondition(registry.activeLeaseCount == 0)
do { _ = try registry.get(handle, NSMutableString.self); fatalError("Released handle was accepted") } catch let error as LucentError { precondition(error.code == "DISPOSED_OBJECT") }
print("swift: native instances, callback invocation, identity and release passed")
`;
writeFileSync(
  join(dir, "main.swift"),
  swift.replace("precondition(try compute() == 10)", "let computed = try compute(); precondition(computed == 10)"),
);
execFileSync(
  "swiftc",
  ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "swift-test")],
  { stdio: "pipe" },
);
process.stdout.write(execFileSync(join(dir, "swift-test")));
const kotlin = `typealias ArrayBuffer = ByteArray\n${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}\n${kotlinObjectRuntime}\n${generateKotlin(result.module).code}
fun main() {
 check(compute() == 10.0)
 val obj = java.lang.StringBuilder("native")
 val handle = LucentObjectRegistry.hold(obj)
 check(handle == LucentObjectRegistry.hold(obj))
 val lease = LucentObjectRegistry.acquire(handle, java.lang.StringBuilder::class.java)
 val retained = lease.value
 check(retained === obj)
 LucentObjectRegistry.release(handle)
 check(lease.value === obj)
 check(LucentObjectRegistry.activeLeaseCount == 1)
 lease.close()
 lease.close()
 check(LucentObjectRegistry.activeLeaseCount == 0)
 try { LucentObjectRegistry.get(handle, java.lang.StringBuilder::class.java); error("Released handle was accepted") } catch (error:LucentError) { check(error.code == "DISPOSED_OBJECT") }
 println("kotlin: native instances, callback invocation, identity and release passed")
}`;
writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], { stdio: "pipe" });
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")]));
