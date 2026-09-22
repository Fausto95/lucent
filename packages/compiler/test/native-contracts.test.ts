import { expect, test } from "vite-plus/test";
import { compile, nativeSymbolId, type LibraryModule } from "../src/index.ts";
test("native symbol identity depends on ABI, not source aliases", () => {
  expect(nativeSymbolId("Foundation", "URL", "init", "(String)->URL")).toBe(
    nativeSymbolId("Foundation", "URL", "init", "(String)->URL"),
  );
  expect(nativeSymbolId("Foundation", "URL", "init", "(String)->URL")).not.toBe(
    nativeSymbolId("Foundation", "URL", "init", "()->URL"),
  );
});
test("rejects unknown native manifest versions", () => {
  const result = compile("export function value():number{return 1;}", {
    fileName: "version.lucent.ts",
    libraries: { "@lucent-lang/test": { schemaVersion: 999, source: "" } as unknown as LibraryModule },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics[0]?.code).toBe("NT1006");
});
test("checks parameter ownership names against declarations", () => {
  const result = compile('import {read} from "@lucent-lang/test"; export function value():number{return read(1);}', {
    fileName: "contract.lucent.ts",
    libraries: {
      "@lucent-lang/test": {
        schemaVersion: 1,
        source: "export declare function read(value:number):number;",
        bindings: {
          read: {
            swift: ["return value"],
            kotlin: ["return value"],
            contract: { symbolId: "test:read", parameters: { missing: { ownership: "borrowed" } } },
          },
        },
      },
    },
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics[0]?.code).toBe("NT1006");
});
test("enforces minimum native API requirements", () => {
  const library: LibraryModule = {
    schemaVersion: 1,
    source: "export declare function modern():number;",
    bindings: {
      modern: {
        swift: ["return 1"],
        kotlin: ["return 1.0"],
        contract: { symbolId: "modern", availability: { ios: "17.0", android: 30 } },
      },
    },
  };
  const source = 'import {modern} from "@lucent-lang/test"; export function value():number{return modern();}';
  expect(
    compile(source, {
      fileName: "api.lucent.ts",
      libraries: { "@lucent-lang/test": library },
      targets: { ios: "16.0", android: 30 },
    }).module,
  ).toBeNull();
  expect(
    compile(source, {
      fileName: "api.lucent.ts",
      libraries: { "@lucent-lang/test": library },
      targets: { ios: "17.0", android: 30 },
    }).diagnostics,
  ).toEqual([]);
});
