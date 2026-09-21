import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { expoHost } from "../src/index.ts";
import { counter } from "../../compiler/test/classes.test.ts";
test("exposes native reference objects through managed handles", () => {
  const module=compile(counter,{fileName:"counter.lucent.ts"}).module!;
  const files=expoHost.emitPackage([module],{packageName:"lucent"});
  expect(files.get("ios/LucentCounterModule.swift")).toContain("LucentObjectRegistry");
  expect(expoHost.emitProxy(module).js).toContain("defineNativeClass");
  expect(expoHost.emitProxy(module).dts).toContain("dispose(): void");
});
