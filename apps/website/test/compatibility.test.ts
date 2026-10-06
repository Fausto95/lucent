import { describe, expect, it } from "vite-plus/test";
import { compilerOptions } from "../../../packages/compiler/src/program.ts";
import { MIN_ANDROID_API, MIN_IOS } from "../../../packages/compiler/src/sdk/schema.ts";
import lucent from "../../../packages/lucent/package.json" with { type: "json" };
import { requirements } from "../src/generated/compatibility.ts";

describe("the compatibility page's numbers", () => {
  it("are the compiler's minimum iOS and Android versions", () => {
    expect(requirements.minIos).toBe(MIN_IOS);
    expect(requirements.minAndroidApi).toBe(MIN_ANDROID_API);
  });

  it("name the TypeScript the package ships and the library level modules are checked against", () => {
    expect(requirements.typescript).toBe(lucent.dependencies.typescript);
    expect(requirements.lib).toEqual(compilerOptions().lib);
  });
});
