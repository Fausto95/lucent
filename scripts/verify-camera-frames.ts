/** Synthetic SDK delivery into a real compiled Lucent frame processor. No device camera claims. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { generateDelegateLibrary } from "../packages/sdk/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
const { library } = generateDelegateLibrary({
  version: 1,
  name: "FrameDelegate",
  swift: { protocol: "FrameListener", imports: [] },
  kotlin: { interface: "FrameListener" },
  resources: { Frame: { swift: "SDKFrame", kotlin: "SDKFrame" } },
  methods: [
    {
      name: "analyze",
      parameters: [{ name: "frame", type: "Frame" }],
      result: "number",
      errors: {
        kind: "fallback",
        value: -1,
        reason: "Reject malformed frames without an exception escaping the SDK callback.",
      },
    },
  ],
});
for (const [name, expression] of Object.entries({
  width: "2.0",
  height: "2.0",
  rowStride: "6.0",
  pixelStride: "2.0",
})) {
  library.source += `\nexport declare function ${name}(frame:Frame):number;`;
  library.bindings![name] = { nativeOnly: true, swift: [`return ${expression}`], kotlin: [`return ${expression}`] };
}
library.source += "\nexport declare function sample(frame:Frame,index:number):number;";
library.bindings!.sample = {
  nativeOnly: true,
  swift: ["return try frame.sample(index)"],
  kotlin: ["return frame.sample(index)"],
};
const processor = readFileSync(new URL("../examples/camera/luminance.lucent.ts", import.meta.url), "utf8");
const result = compile(
  `import {FrameDelegate,Frame} from '@camera/frames'; import {luminance} from './luminance.lucent';
@NativeOnly export function make():FrameDelegate{return new FrameDelegate((frame:Frame):number=>luminance(frame));}`,
  {
    fileName: "camera.lucent.ts",
    sources: { "luminance.lucent.ts": processor },
    libraries: { "@camera/frames": library },
  },
);
if (!result.module) throw new Error(JSON.stringify(result.diagnostics));
const dir = mkdtempSync(join(tmpdir(), "lucent-camera-frames-"));
const swift = `import Foundation
protocol FrameListener:AnyObject {func analyze(_ frame:SDKFrame)->Double}
final class SDKFrame {
 static var open=0
 private var valid=true
 private let bytes:[UInt8]
 init(_ bytes:[UInt8]){self.bytes=bytes;Self.open+=1}
 func sample(_ index:Double)throws->Double {
  guard valid else {throw LucentError(code:"CLOSED_FRAME")}
  guard index>=0 && index<Double(bytes.count) && index.rounded(.down)==index else {throw LucentError(code:"INVALID_FRAME")}
  return Double(bytes[Int(index)])
 }
 func close(){if valid {valid=false;Self.open-=1}}
}
typealias ArrayBuffer=[UInt8]
${swiftRuntime({ length: "return Double(buffer.count)", get: "return Double(buffer[Int(index)])" })}
${Object.values(library.native!.swift!).join("\n")}
${generateSwift(result.module).code}
let listener=try make()
func deliver(_ bytes:[UInt8])->Double {
 let frame=SDKFrame(bytes)
 defer {frame.close()}
 return listener.analyze(frame)
}
for _ in 0..<1000 {
 precondition(deliver([10,255,20,255,255,255,30,255,40])==25)
 precondition(deliver([10]) == -1)
 precondition(SDKFrame.open==0)
}
let closed=SDKFrame([10]);closed.close();closed.close()
precondition(listener.analyze(closed) == -1 && SDKFrame.open==0)
print("swift: strided Lucent luminance, 1000 valid/malformed frame pairs, closed-frame rejection and zero open frames passed")
`;
writeFileSync(join(dir, "main.swift"), swift);
execFileSync(
  "swiftc",
  ["-module-cache-path", join(dir, "cache"), join(dir, "main.swift"), "-o", join(dir, "swift-test")],
  { stdio: "pipe", timeout: 120000 },
);
process.stdout.write(execFileSync(join(dir, "swift-test"), { timeout: 30000 }));
const kotlin = `interface FrameListener {fun analyze(frame:SDKFrame):Double}
class SDKFrame(private val bytes:ByteArray):AutoCloseable {
 companion object {var open=0}
 private var valid=true
 init {open+=1}
 fun sample(index:Double):Double {
  if(!valid) throw LucentError("CLOSED_FRAME")
  if(index<0 || index>=bytes.size || index.toInt().toDouble()!=index) throw LucentError("INVALID_FRAME")
  return (bytes[index.toInt()].toInt() and 255).toDouble()
 }
 override fun close(){if(valid){valid=false;open-=1}}
}
typealias ArrayBuffer=ByteArray
${kotlinRuntime({ imports: [], length: "return buffer.size.toDouble()", get: "return buffer[index.toInt()].toDouble()" })}
${Object.values(library.native!.kotlin!)
  .join("\n")
  .replace(/^package .*\n/gm, "")}
${generateKotlin(result.module).code}
fun main(){
 val listener=make()
 fun deliver(bytes:ByteArray):Double=SDKFrame(bytes).use{listener.analyze(it)}
 repeat(1000){
  check(deliver(byteArrayOf(10,-1,20,-1,-1,-1,30,-1,40))==25.0)
  check(deliver(byteArrayOf(10)) == -1.0)
  check(SDKFrame.open==0)
 }
 val closed=SDKFrame(byteArrayOf(10));closed.close();closed.close()
 check(listener.analyze(closed) == -1.0 && SDKFrame.open==0)
 println("kotlin: strided Lucent luminance, 1000 valid/malformed frame pairs, closed-frame rejection and zero open frames passed")
}
`;
writeFileSync(join(dir, "Main.kt"), kotlin);
execFileSync("kotlinc", [join(dir, "Main.kt"), "-include-runtime", "-d", join(dir, "main.jar")], {
  stdio: "pipe",
  timeout: 120000,
});
process.stdout.write(execFileSync("java", ["-jar", join(dir, "main.jar")], { timeout: 30000 }));
