import { expect, test } from "vite-plus/test";
import { compile, validateLibrary } from "../../compiler/src/index.ts";
import { generateDelegateLibrary, type DelegateSchema } from "../src/index.ts";
export const schema: DelegateSchema = {
  version: 1,
  name: "DecisionDelegate",
  swift: { protocol: "DecisionListener", imports: [], base: "NSObject" },
  kotlin: { interface: "DecisionListener" },
  methods: [
    {
      name: "allow",
      parameters: [{ name: "value", type: "number" }],
      result: "boolean",
      errors: { kind: "fallback", value: false, reason: "Deny the operation if the decision callback fails." },
    },
    {
      name: "evaluate",
      parameters: [{ name: "value", type: "number", swiftLabel: "input" }],
      result: "number",
      errors: { kind: "propagate", swiftThrows: true },
    },
  ],
};
test("generates conformances backed by compiled callbacks and explicit policies", () => {
  const { library, declarations } = generateDelegateLibrary(schema);
  expect(validateLibrary(library)).toEqual([]);
  const result = compile(
    `import {DecisionDelegate} from '@sdk/delegate'; export function construct():number{const threshold=3;const listener=new DecisionDelegate((value:number):boolean=>value>threshold,(value:number):number=>value*2);return 1;}`,
    { fileName: "delegate.lucent.ts", libraries: { "@sdk/delegate": library } },
  );
  expect(result.diagnostics).toEqual([]);
  expect(declarations).toContain("constructor(allow:NativeCallback");
  expect(Object.values(library.native!.swift!).join("\n")).toContain("NSObject, DecisionListener");
  expect(Object.values(library.native!.kotlin!).join("\n")).toContain("override fun allow");
});
test.each([
  { errors: undefined },
  { errors: { kind: "fallback", value: 1, reason: "wrong type" } },
  { errors: { kind: "fallback", value: false, reason: "" } },
  { errors: { kind: "propagate", swiftThrows: false } },
  { name: "class" },
  { result: "toString" },
])("rejects invalid delegate metadata: %j", (patch) => {
  expect(() =>
    generateDelegateLibrary({
      ...schema,
      methods: [{ ...schema.methods[0]!, ...patch } as (typeof schema.methods)[number]],
    }),
  ).toThrow();
});
test("rejects duplicate and unsupported requirements", () => {
  expect(() => generateDelegateLibrary({ ...schema, methods: [schema.methods[0]!, schema.methods[0]!] })).toThrow();
  expect(() =>
    generateDelegateLibrary({
      ...schema,
      methods: [{ ...schema.methods[0]!, parameters: [{ name: "x", type: "Frame" as "number" }] }],
    }),
  ).toThrow();
});

test("curated delegate resources are borrowed native-only callback parameters", () => {
  const { library } = generateDelegateLibrary({
    ...schema,
    resources: { Frame: { swift: "SDKFrame", kotlin: "SDKFrame" } },
    methods: [
      {
        name: "analyze",
        parameters: [{ name: "frame", type: "Frame" }],
        result: "number",
        errors: { kind: "fallback", value: -1, reason: "Reject invalid frame" },
      },
    ],
  });
  expect(validateLibrary(library)).toEqual([]);
  expect(library.references!.Frame).toEqual({
    nativeOnly: true,
    swift: "SDKFrame",
    kotlin: "SDKFrame",
    contract: { ownership: "external", executor: "caller" },
  });
  const result = compile(
    "import {DecisionDelegate,Frame} from '@sdk/delegate'; export function run():number{const listener=new DecisionDelegate((frame:Frame):number=>1);return 1;}",
    { fileName: "frame-delegate.lucent.ts", libraries: { "@sdk/delegate": library } },
  );
  expect(result.diagnostics).toEqual([]);
});
