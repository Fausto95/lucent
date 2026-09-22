import { describe, expect, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COMPILER_VERSION } from "@lucent-lang/compiler";
import { run } from "../src/cli.ts";
import { BAD, fakeIO, MATH, project, wiredExpoProject } from "./helpers.ts";

const ESC = String.fromCharCode(27);

describe("global flags", () => {
  test("--version prints the cli and compiler versions", async () => {
    const io = fakeIO(project({}));
    expect(await run(["--version"], io)).toBe(0);
    expect(io.out()).toMatch(/lucent \d+\.\d+\.\d+/);
    expect(io.out()).toContain(`compiler ${COMPILER_VERSION}`);
  });

  test("--help lists every command with its emoji", async () => {
    const io = fakeIO(project({}));
    expect(await run(["--help"], io)).toBe(0);
    for (const name of ["build", "check", "init", "doctor", "explain", "ir", "clean", "sdk"])
      expect(io.out()).toContain(name);
    expect(io.out()).toContain("🔨");
    expect(io.out()).toContain("--no-color");
  });

  test("no arguments shows help", async () => {
    const io = fakeIO(project({}));
    expect(await run([], io)).toBe(0);
    expect(io.out()).toContain("Usage");
  });

  test("help <command> and <command> --help show the flags and examples", async () => {
    for (const argv of [
      ["help", "build"],
      ["build", "--help"],
    ]) {
      const io = fakeIO(project({}));
      expect(await run(argv, io)).toBe(0);
      expect(io.out()).toContain("--emit-ir");
      expect(io.out()).toContain("--watch");
      expect(io.out()).toContain("Examples");
    }
  });

  test("--no-emoji swaps glyphs for plain symbols", async () => {
    const io = fakeIO(project({}));
    await run(["--help", "--no-emoji"], io);
    expect(io.out()).not.toContain("🔨");
  });

  test("an unknown command suggests the closest one", async () => {
    const io = fakeIO(project({}));
    expect(await run(["buidl"], io)).toBe(1);
    expect(io.err()).toContain('Unknown command "buidl"');
    expect(io.err()).toContain('Did you mean "build"?');
  });

  test("an unknown flag fails with a hint", async () => {
    const io = fakeIO(project({}));
    expect(await run(["build", "--hots", "expo"], io)).toBe(1);
    expect(io.err()).toContain("--hots");
    expect(io.err()).toContain("--host");
  });
});

describe("lucent build", () => {
  test("compiles, then reports cache hits", async () => {
    const root = wiredExpoProject();
    const first = fakeIO(root);
    expect(await run(["build"], first)).toBe(0);
    expect(first.out()).toContain("2 compiled");
    expect(first.out()).toContain("modules/lucent");
    expect(first.out()).toContain("✅");
    expect(first.out()).toContain("expo prebuild");
    const second = fakeIO(root);
    expect(await run(["build"], second)).toBe(0);
    expect(second.out()).toContain("2 cached");
  });

  test("--json prints a machine-readable result only", async () => {
    const io = fakeIO(wiredExpoProject());
    expect(await run(["build", "--json"], io)).toBe(0);
    const result = JSON.parse(io.out()) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, host: "expo", outDir: "modules/lucent", cached: [] });
    expect(result.compiled).toEqual(["src/native/math.lucent.ts", "src/native/text.lucent.ts"]);
    expect(typeof result.durationMs).toBe("number");
  });

  test("--no-color --no-emoji produces plain text", async () => {
    const io = fakeIO(wiredExpoProject(), { env: { FORCE_COLOR: "1" } });
    await run(["build", "--no-color", "--no-emoji"], io);
    expect(io.out()).not.toContain(ESC);
    expect(io.out()).not.toContain("✅");
    expect(io.out()).toContain("✓");
  });

  test("colors diagnostics and exits 1 on errors", async () => {
    const io = fakeIO(wiredExpoProject({ "src/bad.lucent.ts": BAD }), { env: { FORCE_COLOR: "1" } });
    expect(await run(["build"], io)).toBe(1);
    expect(io.err()).toContain("LC1004");
    expect(io.err()).toContain(`${ESC}[31merror${ESC}[39m`);
    expect(io.err()).toContain("1 error");
  });

  test("detects the nitro host from package.json", async () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { "react-native-nitro-modules": "*" } }),
      "src/math.lucent.ts": MATH,
    });
    const io = fakeIO(root);
    expect(await run(["build", "--json", "--no-postgen"], io)).toBe(0);
    expect(JSON.parse(io.out())).toMatchObject({ host: "nitro", outDir: ".lucent/nitro" });
  });

  test("explains what to do when there are no Lucent files", async () => {
    const io = fakeIO(project({ "package.json": "{}" }));
    expect(await run(["build"], io)).toBe(0);
    expect(io.out()).toContain("No Lucent files");
    expect(io.out()).toContain("lucent init");
  });
});

describe("lucent check", () => {
  test("lists each clean file and a summary", async () => {
    const io = fakeIO(wiredExpoProject());
    expect(await run(["check"], io)).toBe(0);
    expect(io.out()).toContain("✅ src/native/math.lucent.ts");
    expect(io.out()).toContain("2 files");
  });

  test("reports errors with codeframes and a count", async () => {
    const io = fakeIO(wiredExpoProject({ "src/bad.lucent.ts": BAD }));
    expect(await run(["check"], io)).toBe(1);
    expect(io.out()).toContain("❌ src/bad.lucent.ts");
    expect(io.err()).toContain("LC1004");
    expect(io.err()).toContain("1 error");
  });

  test("--json carries structured diagnostics", async () => {
    const io = fakeIO(wiredExpoProject({ "src/bad.lucent.ts": BAD }));
    expect(await run(["check", "--json"], io)).toBe(1);
    const result = JSON.parse(io.out()) as { ok: boolean; files: { file: string; diagnostics: unknown[] }[] };
    expect(result.ok).toBe(false);
    const bad = result.files.find((f) => f.file === "src/bad.lucent.ts")!;
    expect(bad.diagnostics[0]).toMatchObject({ code: "LC1004", severity: "error", line: 1 });
  });
});

describe("lucent explain", () => {
  test("describes a diagnostic code", async () => {
    const io = fakeIO(project({}));
    expect(await run(["explain", "lc1004"], io)).toBe(0);
    expect(io.out()).toContain("LC1004");
    expect(io.out()).toContain("`any` is prohibited");
    expect(io.out()).toContain("Language");
  });

  test("lists every code when called without one", async () => {
    const io = fakeIO(project({}));
    expect(await run(["explain"], io)).toBe(0);
    expect(io.out()).toContain("LC1000");
    expect(io.out()).toContain("LC3002");
  });

  test("suggests a close code", async () => {
    const io = fakeIO(project({}));
    expect(await run(["explain", "LC100"], io)).toBe(1);
    expect(io.err()).toContain("Unknown diagnostic code");
    expect(io.err()).toContain('Did you mean "LC1000"?');
  });

  test("--json", async () => {
    const io = fakeIO(project({}));
    await run(["explain", "LC3002", "--json"], io);
    expect(JSON.parse(io.out())).toEqual({
      code: "LC3002",
      title: "Potentially expensive main-thread work",
      category: "warning",
      severity: "warning",
    });
  });
});

describe("lucent ir", () => {
  test("prints the IR of one module", async () => {
    const io = fakeIO(wiredExpoProject());
    expect(await run(["ir", "src/native/math.lucent.ts"], io)).toBe(0);
    expect(io.out()).toContain("export fn add");
  });

  test("--json prints the module", async () => {
    const io = fakeIO(wiredExpoProject());
    await run(["ir", "src/native/math.lucent.ts", "--json"], io);
    expect(JSON.parse(io.out())).toMatchObject({ name: "math" });
  });

  test("needs a file", async () => {
    const io = fakeIO(wiredExpoProject());
    expect(await run(["ir"], io)).toBe(1);
    expect(io.err()).toContain("file");
  });
});

describe("lucent clean", () => {
  test("--dry-run lists targets without removing them", async () => {
    const root = wiredExpoProject();
    await run(["build"], fakeIO(root));
    const io = fakeIO(root);
    expect(await run(["clean", "--dry-run"], io)).toBe(0);
    expect(io.out()).toContain("modules/lucent");
    expect(io.out()).toContain(".lucent/cache.json");
    expect(existsSync(join(root, "modules/lucent"))).toBe(true);
  });

  test("removes generated output and the cache", async () => {
    const root = wiredExpoProject();
    await run(["build"], fakeIO(root));
    expect(await run(["clean"], fakeIO(root))).toBe(0);
    expect(existsSync(join(root, "modules/lucent"))).toBe(false);
    expect(existsSync(join(root, ".lucent/cache.json"))).toBe(false);
    const again = fakeIO(root);
    await run(["clean"], again);
    expect(again.out()).toContain("Nothing to clean");
  });
});
