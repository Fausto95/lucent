import { describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, defaultOutDir, findLucentFiles } from "../src/index.ts";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "lucent-cli-"));
  mkdirSync(join(root, "src", "native"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(
    join(root, "src", "native", "math.lucent.ts"),
    "export function add(a: number, b: number): number { return a + b; }\n",
  );
  writeFileSync(
    join(root, "src", "native", "text.lucent.ts"),
    'export function shout(s: string): string { return s + "!"; }\n',
  );
  writeFileSync(join(root, "node_modules", "dep", "ignored.lucent.ts"), "export function nope(): void {}\n");
  return root;
}

describe("lucent build", () => {
  test("finds lucent files outside node_modules", () => {
    const root = project();
    expect(findLucentFiles(root).map((f) => f.replace(root + "/", ""))).toEqual([
      "src/native/math.lucent.ts",
      "src/native/text.lucent.ts",
    ]);
  });

  test("compiles into the expo module folder and caches", async () => {
    const root = project();
    const log: string[] = [];
    const first = await build({ root, host: "expo", log: (l) => log.push(l) });
    expect(first.ok).toBe(true);
    expect(first.compiled).toEqual(["src/native/math.lucent.ts", "src/native/text.lucent.ts"]);
    expect(first.cached).toEqual([]);
    expect(first.outDir).toBe(join(root, defaultOutDir("expo")));
    expect(existsSync(join(first.outDir, "expo-module.config.json"))).toBe(true);
    expect(existsSync(join(first.outDir, "ios", "LucentMathModule.swift"))).toBe(true);
    expect(log.some((l) => l.includes("⚙") && l.includes("math.lucent.ts"))).toBe(true);

    const second = await build({ root, host: "expo" });
    expect(second.compiled).toEqual([]);
    expect(second.cached).toEqual(["src/native/math.lucent.ts", "src/native/text.lucent.ts"]);

    writeFileSync(
      join(root, "src", "native", "math.lucent.ts"),
      "export function add(a: number, b: number): number { return a - b; }\n",
    );
    const third = await build({ root, host: "expo" });
    expect(third.compiled).toEqual(["src/native/math.lucent.ts"]);
    expect(third.cached).toEqual(["src/native/text.lucent.ts"]);
    expect(readFileSync(join(third.outDir, "ios", "LucentMathModule.swift"), "utf8")).toContain("(a - b)");
  });

  test("reports diagnostics with codeframes and writes nothing", async () => {
    const root = project();
    writeFileSync(join(root, "src", "native", "bad.lucent.ts"), "export function f(x: any): number { return 1; }\n");
    const result = await build({ root, host: "expo" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.fileName).toBe("src/native/bad.lucent.ts");
    expect(result.diagnostics[0]!.rendered).toContain("NT1004");
    expect(existsSync(join(root, defaultOutDir("expo")))).toBe(false);
  });

  test("emits IR text when asked", async () => {
    const root = project();
    const result = await build({ root, host: "expo", emitIR: true });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, ".lucent", "ir", "math.ir.txt"), "utf8")).toContain("export fn add");
  });
});
