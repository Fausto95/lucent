import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseClass } from "../src/classfile.ts";
import { modifiedUtf8 } from "../src/constant-pool.ts";
import { runJavac } from "./jvm-tools.ts";

const javac = spawnSync("javac", ["-version"]).status === 0;

describe("modified UTF-8 (JVMS §4.4.7)", () => {
  it("decodes NUL as two bytes and supplementary characters as surrogate pairs", () => {
    // "a\0😀é": NUL as C0 80, U+1F600 as the surrogates D83D DE00 in three bytes each.
    const bytes = Buffer.from([0x61, 0xc0, 0x80, 0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80, 0xc3, 0xa9]);

    expect(modifiedUtf8(bytes, 0, bytes.length)).toBe("a\u0000😀é");
    expect(modifiedUtf8(Buffer.from("plain"), 0, 5)).toBe("plain");
  });
});

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
