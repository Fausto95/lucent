/**
 * Synthetic SDK delivery into a real compiled Lucent frame processor. No device
 * camera claims. Harness runners live under scripts/native/verify-camera-frames/.
 */
import { readFileSync } from "node:fs";
import { generateDelegateLibrary } from "../packages/sdk/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
import {
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  readNativeTemplate,
} from "./lib/verify-harness.ts";

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

const swiftPackages = Object.values(library.native!.swift!);
const kotlinPackages = Object.values(library.native!.kotlin!).map((src) => src.replace(/^package .*\n/gm, ""));

compileAndRunSwift(
  fillVerifyHarness(readNativeTemplate("verify-camera-frames", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: swiftPackages,
    generated: generateSwift(ir).code,
  }),
  "lucent-camera-frames-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-camera-frames", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: kotlinPackages,
    generated: generateKotlin(ir).code,
  }),
  "lucent-camera-frames-",
);
