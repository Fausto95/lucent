import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runKotlinc, warmKotlin } from "./kotlin-compiler.ts";
import { kotlinToolchain } from "./kotlin-toolchain.ts";

const tc = kotlinToolchain();

describe.skipIf(!tc)("the warm Kotlin compiler", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-warm-kotlinc-"));
  const source = (name: string, text: string) => {
    const file = path.join(dir, name);

    fs.writeFileSync(file, text);
    return file;
  };
  const both = (args: (out: string) => string[]) => {
    const warm = runKotlinc(tc!, args(path.join(dir, "warm")));
    const cold = spawnSync(tc!.kotlinc, args(path.join(dir, "cold")), { encoding: "utf8" });

    return { warm, cold: { status: cold.status, stderr: cold.stderr } };
  };

  it("starts its compiler for this process", () => {
    expect(warmKotlin(tc!)).toBe(true);
  }, 120_000);

  it("compiles what kotlinc compiles, into the same classes", () => {
    const file = source("One.kt", "package t\n\nfun one(): Int = 1\n");
    const { warm, cold } = both((out) => ["-jvm-target", "11", "-Werror", file, "-d", out]);

    expect(warm).toEqual({ status: 0, stderr: "" });
    expect(warm).toEqual(cold);
    expect(fs.existsSync(path.join(dir, "warm/t/OneKt.class"))).toBe(true);
  }, 120_000);

  it("fails as kotlinc fails, printing the same errors and warnings", () => {
    const wrong = source("Wrong.kt", 'package t\n\nfun two(): Int = "two"\n');
    const warned = source("Warned.kt", "package t\n\nfun three(x: Int) = x!!\n");

    for (const file of [wrong, warned]) {
      const { warm, cold } = both((out) => ["-jvm-target", "11", "-Werror", file, "-d", out]);

      expect(warm.status).not.toBe(0);
      expect(warm).toEqual(cold);
    }
  }, 120_000);

  it("compiles again and again in one process, each compile on its own", () => {
    const file = source("Four.kt", "package t\n\nfun four(): Int = 4\n");

    for (let i = 0; i < 3; i++)
      expect(
        runKotlinc(tc!, ["-jvm-target", "11", file, "-d", path.join(dir, `again${i}`)]),
      ).toEqual({
        status: 0,
        stderr: "",
      });
  }, 120_000);
});
