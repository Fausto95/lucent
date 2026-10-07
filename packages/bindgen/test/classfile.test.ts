import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseClass } from "../src/classfile.ts";
import { runJavac } from "./jvm-tools.ts";

const javac = spawnSync("javac", ["-version"]).status === 0;

describe.skipIf(!javac)("class file constants", () => {
  it("reads string constants holding NUL and characters outside the BMP", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-classfile-"));
    const src = path.join(dir, "Strings.java");
    fs.writeFileSync(
      src,
      'public class Strings {\n  public static final String FACE = "a\\u0000\\uD83D\\uDE00\\u00e9";\n}\n',
    );
    const cc = runJavac(["--release", "11", "-d", dir, src]);
    if (cc.status !== 0) throw new Error(cc.stderr);

    const cls = parseClass(fs.readFileSync(path.join(dir, "Strings.class")));

    expect(cls.fields.find((f) => f.name === "FACE")?.constant).toBe("a\u0000😀é");
  });
});
