import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { cachedModules, sdkAvailable } from "@lucent-lang/bindgen";
import { project } from "./platforms-fixtures.ts";

// Apart from platforms.test.ts: a cold extraction takes minutes, and a file's tests run one
// after the other, so the rest of the platform tests run beside it.

/**
 * `compile` in a process of its own. A cold SDK extraction blocks for about a
 * minute, longer than vitest lets a worker go without answering its RPCs.
 */
function compileInChild(
  files: string[],
  options: object,
): Promise<{ diagnostics: unknown[]; types: Record<string, string> }> {
  const index = path.resolve(import.meta.dirname, "../src/index.ts");
  const code = `import { compile } from ${JSON.stringify(index)};
const r = compile(${JSON.stringify(files)}, ${JSON.stringify(options)});
process.stdout.write(JSON.stringify({ diagnostics: r.diagnostics, types: Object.fromEntries(r.types ?? []) }));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (status) =>
      status === 0
        ? resolve(JSON.parse(out))
        : reject(new Error(`compile failed (${status}):\n${err}`)),
    );
  });
}

/** A module whose iOS side imports a small framework, whose signatures name Foundation's types. */
const authenticating = {
  "auth.lucent.ts": "export declare function available(): Promise<boolean>;\n",
  "auth.ios.lucent.ts": `import { LAContext, LAPolicy } from "lucent:ios/LocalAuthentication";
import { main } from "lucent:thread";

export function available(): Promise<boolean> {
  return main(() => new LAContext().canEvaluatePolicy(LAPolicy.deviceOwnerAuthentication, null));
}
`,
  "auth.android.lucent.ts":
    "export async function available(): Promise<boolean> {\n  return false;\n}\n",
};

describe.skipIf(!sdkAvailable("ios"))("platform modules, from a cold SDK cache", () => {
  it("types other frameworks in signatures by name, without extracting them", async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cache-"));
    // A cold cache on purpose: extracting LocalAuthentication must not extract Foundation's
    // schema, which its signatures name, either. (A small framework: UIKit takes minutes.)
    const r = await compileInChild(project(authenticating), {
      platforms: ["ios"],
      sdk: { cacheDir },
    });
    expect(r.diagnostics).toEqual([]);
    // Only what the program imports gets a full schema.
    const cached = cachedModules("ios", { cacheDir });
    expect("schemas" in cached && cached.schemas).toEqual(["LocalAuthentication"]);
    expect("names" in cached && cached.names).toContain("Foundation");
    expect(r.types["ios/Foundation.d.ts"]).toMatch(/Names only: import lucent:ios\/Foundation/);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }, 600_000);
});
