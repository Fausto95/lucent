import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";

const index = path.resolve(import.meta.dirname, "../src/index.ts");

/** The declarations a compile in a new process gives `lucent:android/android.os`. */
function declarationsInChild(files: string[], cacheDir: string): string {
  const code = `import { compile } from ${JSON.stringify(index)};
const r = compile(${JSON.stringify(files)}, { platforms: ["android"], sdk: { cacheDir: ${JSON.stringify(cacheDir)} } });
if (r.diagnostics.length) throw new Error(JSON.stringify(r.diagnostics));
process.stdout.write(new Map(r.types ?? []).get("android/android.os.d.ts") ?? "");`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });

  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

describe.skipIf(!sdkAvailable("android"))("SDK declarations across processes", () => {
  it("writes a module's declarations once, then reads them from the cache", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-declarations-"));
    const cacheDir = path.join(dir, "cache");
    const files = [path.join(dir, "m.lucent.ts"), path.join(dir, "m.android.lucent.ts")];

    fs.writeFileSync(files[0]!, "export declare function model(): Promise<string>;\n");
    fs.writeFileSync(
      files[1]!,
      'import { Build } from "lucent:android/android.os";\nexport async function model(): Promise<string> { return Build.MODEL ?? ""; }\n',
    );

    const written = declarationsInChild(files, cacheDir);
    const cached = fs
      .readdirSync(path.join(cacheDir, "declarations"), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".d.ts"))
      .map((f) => path.join(cacheDir, "declarations", f))
      .find((f) => fs.readFileSync(f, "utf8") === written);

    expect(written).toContain("class Build");
    expect(cached).toBeDefined();

    // Another process reads what the first wrote, rather than writing it again.
    fs.appendFileSync(cached!, "// read from the cache\n");

    expect(declarationsInChild(files, cacheDir)).toBe(`${written}// read from the cache\n`);
  }, 300_000);
});
