import { expect, test } from "vite-plus/test";
import { compile } from "../../compiler/src/index.ts";
import { readFileSync, existsSync } from "node:fs";
import { defineNativeConfig } from "@lucent-lang/core/config";
import { expoHost } from "../../host-expo/src/index.ts";
import { nitroHost } from "../../host-nitro/src/index.ts";

test.each([
  'import type {int32} from "@lucent-lang/core/types"; export function identity(value:int32):int32{return value;}',
  'import {SharedObject} from "@lucent-lang/core/objects"; export class Counter extends SharedObject {value:number=0;}',
  'import {event} from "@lucent-lang/core/events"; export const changed=event<number>(); export function notify():void{changed.emit(1);}',
  'import {Platform} from "@lucent-lang/core/platform"; export function platform():string{return Platform.OS;}',
  'import {VStack,Text,type NativeView} from "@lucent-lang/core/ui"; export function Screen():NativeView{return <VStack><Text>Lucent</Text></VStack>;}',
])("compiles public core authoring subpaths: %s", (source) => {
  const result = compile(source, { fileName: "public.lucent.tsx" });
  expect(result.diagnostics).toEqual([]);
  expect(result.module).not.toBeNull();
});
test.each(["types", "ui", "events", "objects", "platform"])("does not retain the old %s import", (name) => {
  const result = compile(`import {missing} from "@lucent-lang/${name}"; export function value():number{return 1;}`, {
    fileName: "old.lucent.ts",
  });
  expect(result.module).toBeNull();
  expect(result.diagnostics[0]?.code).toBe("LUCENT1006");
});
test("configuration is executable from the public entry point", () => {
  const config = { targets: { ios: "18.0" } };
  expect(defineNativeConfig(config)).toBe(config);
});
test("every public entry point is included in the package file list", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const entry of Object.values(pkg.exports) as Record<string, string>[])
    for (const path of Object.values(entry)) {
      expect(existsSync(new URL(`../${path}`, import.meta.url))).toBe(true);
      expect(pkg.files).toContain(path.slice(2));
    }
});
for (const host of [expoHost, nitroHost])
  test(`${host.name} proxies use only the public runtime import`, () => {
    const module = compile("export function value():number{return 1;}", { fileName: "public.lucent.ts" }).module!;
    expect(host.emitProxy(module).js).toContain('from "@lucent-lang/core/runtime"');
    expect(host.emitProxy(module).js).not.toContain('from "@lucent-lang/runtime"');
  });
