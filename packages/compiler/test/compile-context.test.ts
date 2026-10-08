import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, type ExtensionBinding } from "../src/index.ts";
import { sdkCacheDir, withSdkOptions } from "../src/sdk/schema.ts";

/** A project directory with `sources`, by module name. */
function project(sources: Record<string, string>): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ctx-"));

  return Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, `${name}.lucent.ts`);
    fs.writeFileSync(f, src);
    return f;
  });
}

/** An extension binding with one function, `<name>_twice(int32_t) -> int32_t`. */
function extension(name: string): ExtensionBinding {
  return {
    name,
    package: `lucent-${name}`,
    include: `${name}.h`,
    handles: [],
    functions: [
      {
        name: `${name}_twice`,
        params: [{ kind: "number", name: "n", c: "int32_t" }],
        result: { kind: "number", c: "int32_t" },
        affinity: "any",
        blocking: false,
      },
    ],
    skipped: [],
  };
}

describe("compile contexts", () => {
  it("keep a compile's extensions and reads its own while another compile runs inside it", () => {
    const [a] = project({
      a: `import { alpha_twice } from "lucent:ext/alpha";\nexport function f(n: number): number { return alpha_twice(n); }\n`,
    });
    const [b] = project({
      b: `import { beta_twice } from "lucent:ext/beta";\nexport function g(n: number): number { return beta_twice(n); }\n`,
    });
    let inner: ReturnType<typeof compile> | undefined;
    // The second compile runs while the first reads its sources: an editor's check during a build.
    const readSource = (file: string) => {
      if (!inner && file === a) inner = compile([b!], { extensions: [extension("beta")] });
      return undefined;
    };
    const outer = compile([a!], { extensions: [extension("alpha")], readSource });

    expect(inner).toBeDefined();
    expect(inner!.diagnostics.map((d) => d.message)).not.toContainEqual(
      expect.stringContaining("alpha"),
    );
    expect(outer.diagnostics.map((d) => d.message)).not.toContainEqual(
      expect.stringContaining("beta"),
    );
    expect([...outer.read.keys()]).toContain(a);
    expect([...outer.read.keys()]).not.toContain(b);
    expect([...inner!.read.keys()]).toContain(b);
    expect([...inner!.read.keys()]).not.toContain(a);
  });

  it("are separate for compiles running concurrently", async () => {
    const files = [1, 2, 3, 4].map(
      (i) =>
        project({
          [`m${i}`]: `export function f${i}(n: number): number { return n * ${i}; }\n`,
        })[0]!,
    );
    const results = await Promise.all(
      files.map(async (f, i) => {
        await new Promise((r) => setTimeout(r, (4 - i) * 5));
        return compile([f]);
      }),
    );

    results.forEach((r, i) => {
      expect(r.diagnostics).toEqual([]);
      const own = [...r.read.keys()].filter((k) => k.endsWith(".lucent.ts"));
      expect(own).toEqual([files[i]]);
    });
  });

  it("hold across awaits, so interleaved work of two compiles sees each its own options", async () => {
    const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const [a, b] = await Promise.all([
      withSdkOptions({ cacheDir: "/cache/a" }, async () => {
        await tick(10);
        return sdkCacheDir();
      }),
      withSdkOptions({ cacheDir: "/cache/b" }, async () => {
        await tick(1);
        return sdkCacheDir();
      }),
    ]);

    expect([a, b]).toEqual(["/cache/a", "/cache/b"]);
    expect(sdkCacheDir()).toBeUndefined();
  });
});
