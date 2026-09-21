import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { expoHost } from "../src/index.ts";
test("bridges subscriptions and cleans up native listeners", () => {
  const module = compile(
    'import {event} from "@lucent-lang/events"; export const progress=event<number>(); export function run():void { progress.emit(50); }',
    { fileName: "progress.lucent.ts" },
  ).module!;
  const tree = expoHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("ios/LucentProgressModule.swift")).toContain("LucentEventHub.shared.subscribe");
  expect(tree.get("ios/LucentProgressModule.swift")).toContain("OnDestroy");
  expect(expoHost.emitProxy(module).js).toContain("addListener");
  expect(expoHost.emitProxy(module).dts).toContain("subscribe");
});
