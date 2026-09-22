/** Compile generated conformances against real Swift/Kotlin protocol declarations. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateDelegateLibrary, type DelegateSchema } from "../packages/sdk/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
const schema: DelegateSchema = {
  version: 1,
  name: "DecisionDelegate",
  swift: { protocol: "DecisionListener", imports: [], base: "NSObject" },
  kotlin: { interface: "DecisionListener" },
  methods: [
    {
      name: "allow",
      parameters: [{ name: "value", type: "number" }],
      result: "boolean",
      errors: { kind: "fallback", value: false, reason: "Deny on callback failure." },
    },
    {
      name: "evaluate",
      parameters: [{ name: "value", type: "number", swiftLabel: "input" }],
      result: "number",
      errors: { kind: "propagate", swiftThrows: true },
    },
  ],
};
const { library } = generateDelegateLibrary(schema);
library.source += `\nexport type Resource={value:number};
export declare function Resource__create():Resource;
export declare function Resource__get_value(lucentSelf:Resource):number;`;
library.references!.Resource = {
  nativeOnly: true,
  swift: "TrackedResource",
  kotlin: "TrackedResource",
  contract: { ownership: "owned", executor: "caller" },
};
library.bindings!.Resource__create = {
  nativeOnly: true,
  swift: ["return TrackedResource()"],
  kotlin: ["return TrackedResource()"],
};
library.bindings!.Resource__get_value = { swift: ["return lucentSelf.value"], kotlin: ["return lucentSelf.value"] };
const result = compile(
  `import {DecisionDelegate,Resource} from '@sdk/delegate';
function make():DecisionDelegate {
 const resource=new Resource();
 return new DecisionDelegate((value:number):boolean=>{if(value<0){throw new LucentError("NEGATIVE");}return value>resource.value;},(value:number):number=>{if(value<0){throw new LucentError("NEGATIVE");}return value*2;});
}
export function marker():number{return 1;}`,
  { fileName: "delegate.lucent.ts", libraries: { "@sdk/delegate": library } },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const dir = mkdtempSync(join(tmpdir(), "lucent-delegates-"));
const swift = `import Foundation
protocol DecisionListener: AnyObject { func allow(_ value:Double)->Bool;func evaluate(input value:Double)throws->Double }
final class TrackedResource { static var live=0; let value=3.0;init(){Self.live+=1};deinit{Self.live-=1} }
final class WeakSDK { weak var listener: (any DecisionListener)? }
typealias ArrayBuffer=[UInt8]
${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}
${Object.values(library.native!.swift!).join("\n")}
${generateSwift(result.module).code}
let sdk=WeakSDK()
func exercise() throws {
 let owner=try make()
 sdk.listener=owner
 precondition(TrackedResource.live==1)
 precondition(sdk.listener!.allow(4))
 precondition(!sdk.listener!.allow(-1))
 let doubled=try sdk.listener!.evaluate(input:3)
 precondition(doubled==6)
 do { _ = try sdk.listener!.evaluate(input:-1);fatalError("error swallowed") } catch let error as LucentError { precondition(error.code=="NEGATIVE") }
 withExtendedLifetime(owner) {}
}
try exercise()
precondition(sdk.listener==nil && TrackedResource.live==0)
print("swift: concrete delegate conformance, decisions, error policies and capture teardown passed")
`;
writeFileSync(join(dir, "main.swift"), swift);
execFileSync(
  "swiftc",
  ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "swift-test")],
  { stdio: "pipe", timeout: 120000 },
);
process.stdout.write(execFileSync(join(dir, "swift-test"), { timeout: 30000 }));
const kotlin = `interface DecisionListener {fun allow(value:Double):Boolean;fun evaluate(value:Double):Double}
class TrackedResource {val value=3.0}
class WeakSDK {var listener:java.lang.ref.WeakReference<DecisionListener>?=null}
typealias ArrayBuffer=ByteArray
${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}
${Object.values(library.native!.kotlin!)
  .join("\n")
  .replace(/^package .*\n/gm, "")}
${generateKotlin(result.module).code}
fun main() {
 val sdk=WeakSDK();val owner=make();sdk.listener=java.lang.ref.WeakReference(owner)
 check(sdk.listener!!.get()!!.allow(4.0));check(!sdk.listener!!.get()!!.allow(-1.0))
 check(sdk.listener!!.get()!!.evaluate(3.0)==6.0)
 try {sdk.listener!!.get()!!.evaluate(-1.0);error("error swallowed")} catch(error:LucentError){check(error.code=="NEGATIVE")}
 java.lang.ref.Reference.reachabilityFence(owner)
 println("kotlin: concrete delegate conformance, decisions, retained captures and error policies passed")
}
`;
writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], {
  stdio: "pipe",
  timeout: 120000,
});
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")], { timeout: 30000 }));
