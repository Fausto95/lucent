import { describe, expect, test } from "vite-plus/test";
import { createTransformer, type UpstreamTransformer } from "../src/transformer.ts";
import { withLucent } from "../src/index.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const calls: { src: string; filename: string }[] = [];
const upstream: UpstreamTransformer = {
  transform: (args) => {
    calls.push({ src: args.src, filename: args.filename });
    return { ast: { type: "File" } };
  },
  getCacheKey: () => "upstream-key",
};

describe("lucent metro transformer", () => {
  test("resolves relative Metro filenames against projectRoot", async () => {
    const root = mkdtempSync(join(tmpdir(), "lucent-metro-"));
    try {
      writeFileSync(join(root, "package.json"), "{}");
      writeFileSync(join(root, "helper.lucent.ts"), "export function helper():number{return 42;}");
      const t = createTransformer({ upstream, host: "expo" });
      await expect(
        t.transform({
          src: 'import {helper} from "./helper.lucent"; export function answer():number{return helper();}',
          filename: "main.lucent.ts",
          options: { projectRoot: root },
        }),
      ).resolves.toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("replaces .lucent.ts sources with the host proxy before delegating", async () => {
    calls.length = 0;
    const t = createTransformer({ upstream, host: "expo" });
    await t.transform({
      src: "export function add(a: number, b: number): number { return a + b; }",
      filename: "/app/src/math.lucent.ts",
      options: {},
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.filename).toBe("/app/src/math.lucent.ts");
    expect(calls[0]!.src).toContain('requireNativeModule("Lucent_math")');
    expect(calls[0]!.src).toContain("export function add(a, b)");
  });

  test("uses the nitro proxy when configured", async () => {
    calls.length = 0;
    const t = createTransformer({ upstream, host: "nitro" });
    await t.transform({
      src: "export function add(a: number, b: number): number { return a + b; }",
      filename: "/app/math.lucent.ts",
      options: {},
    });
    expect(calls[0]!.src).toContain('createHybridObject("Math")');
  });

  test("passes other files through untouched", async () => {
    calls.length = 0;
    const t = createTransformer({ upstream, host: "expo" });
    await t.transform({ src: "const x = 1;", filename: "/app/App.tsx", options: {} });
    expect(calls[0]!.src).toBe("const x = 1;");
  });

  test("throws a rendered diagnostic for invalid lucent code", async () => {
    const t = createTransformer({ upstream, host: "expo" });
    await expect(
      t.transform({
        src: "export function f(x: any): number { return 1; }",
        filename: "/app/bad.lucent.ts",
        options: {},
      }),
    ).rejects.toThrow(/LC1004/);
  });

  test("cache key includes upstream, compiler version and host", () => {
    const t = createTransformer({ upstream, host: "nitro" });
    expect(t.getCacheKey()).toContain("upstream-key");
    expect(t.getCacheKey()).toContain("nitro");
  });
});

describe("withLucent", () => {
  test("points babelTransformerPath at the lucent transformer and records the host", () => {
    const config = withLucent({ transformer: { babelTransformerPath: "/x/upstream.js" } }, { host: "nitro" });
    expect(config.transformer.babelTransformerPath).toMatch(/packages\/metro\/dist\/transformer\.cjs$/);
    expect(process.env.LUCENT_HOST).toBe("nitro");
    expect(process.env.LUCENT_UPSTREAM_TRANSFORMER).toBe("/x/upstream.js");
  });
});
