import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../../compiler/src/index.ts";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";
const library: LibraryModule = {
  source:
    "export type Text = {length:number}; export declare function Text__create(value:string):Text; export declare function Text__get_length(lucentSelf:Text):number;",
  references: {
    Text: {
      swift: "NSString",
      swiftImports: ["Foundation"],
      kotlin: "java.lang.String",
      contract: { ownership: "owned", executor: "caller", transferable: true },
    },
  },
  bindings: {
    Text__create: { swift: ["return NSString(string:value)"], kotlin: ["return java.lang.String(value)"] },
    Text__get_length: { swift: ["return Double(lucentSelf.length)"], kotlin: ["return lucentSelf.length.toDouble()"] },
  },
};
const source =
  'import {Text} from "@lucent-lang/sdk/text"; export async function length(value:Text):Promise<number>{return value.length;}';
const options = { fileName: "async-text.lucent.ts", libraries: { "@lucent-lang/sdk/text": library } };
test("accepts async references only with explicit transferable ownership", () => {
  const result = compile(source, options);
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
  for (const contract of [
    { ownership: "owned", executor: "main", transferable: true },
    { ownership: "external", executor: "caller", transferable: true },
    { ownership: "owned", executor: "caller", transferable: false },
  ] as const) {
    const invalid = structuredClone(library);
    invalid.references!.Text!.contract = contract;
    expect(compile(source, { ...options, libraries: { "@lucent-lang/sdk/text": invalid } }).module).toBeNull();
  }
});
for (const [name, host] of [
  ["expo", expoHost],
  ["nitro", nitroHost],
] as const)
  test(`${name} retains native objects for asynchronous work`, () => {
    const result = compile(source, options);
    expect(result.module).not.toBeNull();
    const files = host.emitPackage([result.module!], { packageName: "lucent" });
    expect(host.emitProxy(result.module!).js).toContain("withNativeObjects([value]");
    const swift = [...files]
      .filter(([path]) => path.endsWith(".swift"))
      .map(([, body]) => body)
      .join("\n");
    const kotlin = [...files]
      .filter(([path]) => path.endsWith(".kt"))
      .map(([, body]) => body)
      .join("\n");
    expect(swift).toContain("acquireMany([value])");
    expect(swift).toContain("defer { lucentLeases.close() }");
    expect(kotlin).toContain("acquireMany(listOf(value))");
    expect(kotlin).toContain("finally { lucentLeases.close() }");
    if (name === "nitro")
      expect(swift.indexOf("acquireMany([value])")).toBeLessThan(swift.indexOf("return Promise.async"));
  });
