import { expect, test } from "vite-plus/test";
import { generateBindingLibrary, type SDKSchema } from "../src/index.ts";
import { compile } from "../../compiler/src/index.ts";
test("generates actual native SDK class constructors, properties and methods", () => {
  const schema: SDKSchema = {
    version: 1,
    platform: "android",
    module: "java.lang",
    functions: [],
    diagnostics: [],
    classes: [
      {
        name: "TextBuffer",
        nativeName: "java.lang.StringBuilder",
        constructor: { parameters: [{ name: "text", nativeType: "String" }] },
        properties: [{ name: "length", nativeType: "int", getter: "length" }],
        methods: [
          {
            name: "append",
            nativeName: "append",
            parameters: [{ name: "text", nativeType: "String" }],
            returnType: "void",
          },
        ],
      },
    ],
  };
  const generated = generateBindingLibrary(schema);
  expect(generated.library.references?.TextBuffer?.kotlin).toBe("java.lang.StringBuilder");
  expect(generated.declarations).toContain("readonly length: int32");
  const result = compile(
    'import {TextBuffer} from "@lucent-lang/sdk/text"; import {Platform} from "@lucent-lang/core/platform"; export function run():void {if(Platform.OS === "android"){const text=new TextBuffer("hello");text.append(" world");}}',
    { fileName: "sdk.lucent.ts", libraries: { "@lucent-lang/sdk/text": generated.library } },
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});
test("rejects duplicate public native method identities", () => {
  const fn = { name: "append", nativeName: "append", parameters: [], returnType: "void" };
  expect(() =>
    generateBindingLibrary({
      version: 1,
      platform: "android",
      module: "java.lang",
      functions: [],
      diagnostics: [],
      classes: [
        {
          name: "TextBuffer",
          nativeName: "java.lang.StringBuilder",
          constructor: { parameters: [] },
          properties: [],
          methods: [fn, fn],
        },
      ],
    }),
  ).toThrow(/duplicate/i);
});
