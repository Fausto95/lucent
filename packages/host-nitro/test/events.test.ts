import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { nitroHost } from "../src/index.ts";
test("bridges typed native event subscriptions", () => {
  const module = compile(
    'import {event} from "@lucent-lang/core/events"; export const progress=event<number>(); export function run():void { progress.emit(50); }',
    { fileName: "progress.lucent.ts" },
  ).module!;
  const tree = nitroHost.emitPackage([module], { packageName: "lucent" });
  expect(tree.get("src/specs/Progress.nitro.ts")).toContain("subscribeProgress");
  expect(nitroHost.emitProxy(module).js).toContain("unsubscribeProgress");
});
