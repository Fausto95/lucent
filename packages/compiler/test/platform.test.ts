import { expect, test } from "vite-plus/test";
import { compile, type LibraryModule } from "../src/index.ts";
const libraries: Record<string, LibraryModule> = {
  "@lucent-lang/platform/test": {
    source: "export declare function iosOnly():number;",
    bindings: { iosOnly: { swift: ["return 1"], kotlin: ["return 1.0"], platforms: ["ios"] } },
  },
};
const prelude = 'import {Platform} from "@lucent-lang/platform"; import {iosOnly} from "@lucent-lang/platform/test";';
const check = (body: string) => compile(prelude + body, { fileName: "platform.lucent.ts", libraries });
test("rejects unguarded platform-specific calls", () => {
  expect(check("export function f():number{return iosOnly();}").diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "NT2004" })]),
  );
});
test.each([
  'export function f():number{if(Platform.OS === "ios"){return iosOnly();}return 0;}',
  'export function f():number{if(Platform.OS !== "android"){return helper();}return 0;} function helper():number{return iosOnly();}',
  'export function f():number{if(Platform.OS === "android"){return 0;}else{return iosOnly();}}',
])("allows guarded platform calls and helper chains", (source) => {
  expect(check(source).diagnostics).toEqual([]);
  expect(check(source).module).not.toBeNull();
});
test("rejects an exported helper reachable without a guard", () => {
  expect(
    check(
      'export function f():number{if(Platform.OS === "ios"){return helper();}return 0;} export function helper():number{return iosOnly();}',
    ).module,
  ).toBeNull();
});
test("does not leak branch guards into following statements", () => {
  expect(check('export function f():number{if(Platform.OS === "ios"){iosOnly();}return iosOnly();}').module).toBeNull();
});
