import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { nitroHost } from "../src/index.ts";
import { counter } from "../../compiler/test/samples.ts";
test("keeps shared native class identity across the Nitro boundary", () => {
  const module = compile(counter, { fileName: "counter.lucent.ts" }).module!;
  const files = nitroHost.emitPackage([module], { packageName: "lucent" });
  expect(files.get("ios/HybridCounter.swift")).toContain("LucentObjectRegistry");
  expect(nitroHost.emitProxy(module).js).toContain("defineNativeClass");
  expect(files.get("src/specs/Counter.nitro.ts")).toContain("lucentRelease");
});
