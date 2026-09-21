import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { expoHost } from "../src/index.ts";
test("disambiguates zero-argument Kotlin coroutine bindings", () => {
  const module = compile('export async function device():Promise<string>{return "phone";}', {
    fileName: "device.lucent.ts",
  }).module!;
  const files = expoHost.emitPackage([module], { packageName: "lucent" });
  expect(files.get("android/src/main/java/expo/modules/lucent/LucentDeviceModule.kt")).toContain("Coroutine { ->");
});
