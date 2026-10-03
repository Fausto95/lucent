import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runJar, runJavac, runKotlinc, type ToolResult, warmJvm } from "./jvm-tools.ts";
import { kotlinToolchain } from "./kotlin-toolchain.ts";

const tc = kotlinToolchain();
const jdk =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-jvm-tools-"));
const source = (name: string, text: string) => {
  const file = path.join(dir, name);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

/** A warm run and the command's, each with its own output directory. */
function both(
  warm: (args: string[]) => ToolResult,
  command: string,
  args: (out: string) => string[],
): { warm: ToolResult; cold: ToolResult } {
  const cold = spawnSync(command, args(path.join(dir, "cold")), { encoding: "utf8" });

  return {
    warm: warm(args(path.join(dir, "warm"))),
    cold: { status: cold.status, stdout: cold.stdout, stderr: cold.stderr },
  };
}

describe.skipIf(!jdk)("the warm JVM tools", () => {
  it("start their server for this process", () => {
    expect(warmJvm()).toBe(true);
  }, 120_000);

  it("compile Java as javac does: the same classes, the same errors", () => {
    const good = source("good/p/Good.java", "package p;\n\npublic class Good {}\n");
    const bad = source("bad/p/Bad.java", 'package p;\n\npublic class Bad { int x = "x"; }\n');
    const ok = both(runJavac, "javac", (out) => ["--release", "11", "-d", out, good]);

    expect(ok.warm).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(ok.warm).toEqual(ok.cold);
    expect(fs.existsSync(path.join(dir, "warm/p/Good.class"))).toBe(true);

    const failed = both(runJavac, "javac", (out) => ["--release", "11", "-d", out, bad]);

    expect(failed.warm.status).not.toBe(0);
    expect(failed.warm).toEqual(failed.cold);
  }, 120_000);

  it("pack jars as jar does: the same entries", () => {
    const classes = path.join(dir, "jar-input");

    source("jar-input/p/A.txt", "a");
    source("jar-input/p/q/B.txt", "b");

    const { warm, cold } = both(runJar, "jar", (out) => ["cf", `${out}.jar`, "-C", classes, "."]);
    const list = (jar: string) =>
      spawnSync("jar", ["tf", jar], { encoding: "utf8" }).stdout.split("\n").sort();

    expect(warm).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(warm).toEqual(cold);
    expect(list(path.join(dir, "warm.jar"))).toEqual(list(path.join(dir, "cold.jar")));
  }, 120_000);
});

describe.skipIf(!tc)("the warm Kotlin compiler", () => {
  const kotlinc = (args: (out: string) => string[]) =>
    both((a) => runKotlinc(tc!, a), tc!.kotlinc, args);

  it("compiles what kotlinc compiles, into the same classes", () => {
    const file = source("One.kt", "package t\n\nfun one(): Int = 1\n");
    const { warm, cold } = kotlinc((out) => ["-jvm-target", "11", "-Werror", file, "-d", out]);

    expect(warm).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(warm).toEqual(cold);
    expect(fs.existsSync(path.join(dir, "warm/t/OneKt.class"))).toBe(true);
  }, 120_000);

  it("fails as kotlinc fails, printing the same errors and warnings", () => {
    const wrong = source("Wrong.kt", 'package t\n\nfun two(): Int = "two"\n');
    const warned = source("Warned.kt", "package t\n\nfun three(x: Int) = x!!\n");

    for (const file of [wrong, warned]) {
      const { warm, cold } = kotlinc((out) => ["-jvm-target", "11", "-Werror", file, "-d", out]);

      expect(warm.status).not.toBe(0);
      expect(warm).toEqual(cold);
    }
  }, 120_000);

  it("compiles again and again in one process, each compile on its own", () => {
    const file = source("Four.kt", "package t\n\nfun four(): Int = 4\n");

    for (let i = 0; i < 3; i++)
      expect(
        runKotlinc(tc!, ["-jvm-target", "11", file, "-d", path.join(dir, `again${i}`)]),
      ).toEqual({ status: 0, stdout: "", stderr: "" });
  }, 120_000);
});
