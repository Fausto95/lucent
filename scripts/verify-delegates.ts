/**
 * Compile generated conformances against real Swift/Kotlin protocol declarations.
 * Harness runners live under scripts/native/verify-delegates/.
 */
import { generateDelegateLibrary, type DelegateSchema } from "../packages/sdk/src/index.ts";
import { compile } from "../packages/compiler/src/index.ts";
import { generateSwift, swiftRuntime } from "../packages/backend-swift/src/index.ts";
import { generateKotlin, kotlinRuntime } from "../packages/backend-kotlin/src/index.ts";
import {
  compileAndRunKotlin,
  compileAndRunSwift,
  fillVerifyHarness,
  readNativeTemplate,
} from "./lib/verify-harness.ts";

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
  fillVerifyHarness(readNativeTemplate("verify-delegates", "Runner.swift"), {
    runtime: runtimeSwift,
    packages: swiftPackages,
    generated: generateSwift(ir).code,
  }),
  "lucent-delegates-",
);

compileAndRunKotlin(
  fillVerifyHarness(readNativeTemplate("verify-delegates", "Main.kt"), {
    runtime: runtimeKotlin,
    packages: kotlinPackages,
    generated: generateKotlin(ir).code,
  }),
  "lucent-delegates-",
);
