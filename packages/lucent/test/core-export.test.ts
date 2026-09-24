import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Resolves as an app would: the package by name, through its exports map.
const requireFromPackage = createRequire(path.join(pkg, "package.json"));

type Core = {
  error(code: string, message: string): Error & { code?: string };
  errorCode(e: Error): string | undefined;
  delay(ms: number): Promise<void>;
  utf8Decode(bytes: Uint8Array): string;
  utf8Encode(s: string): Uint8Array;
};

describe("@lucent-lang/lucent/core", () => {
  it("is lucent:core's JavaScript implementation, for tests that run modules as TypeScript", async () => {
    const core = requireFromPackage("@lucent-lang/lucent/core") as Core;
    const e = core.error("E_EMPTY", "The config is empty");
    expect(e).toBeInstanceOf(Error);
    expect(core.errorCode(e)).toBe("E_EMPTY");
    await expect(core.delay(1)).resolves.toBeUndefined();
    expect(core.utf8Decode(core.utf8Encode("é"))).toBe("é");
  });

  it("declares its types with lucent:core's declarations, which the published package ships", () => {
    const exported = (JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8")) as { exports: Record<string, { types?: string }> }).exports["./core"];
    expect(exported?.types).toBe("./lib/sdk/core.d.ts");
    // lib/ is the compiler's lib/, copied by scripts/build.mts.
    expect(fs.existsSync(path.join(pkg, "../compiler/lib/sdk/core.d.ts"))).toBe(true);
  });
});
