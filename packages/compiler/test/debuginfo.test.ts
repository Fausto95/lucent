import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir } from "../src/index.ts";

const dwarfdump = ["llvm-dwarfdump", "dwarfdump"].find(
  (t) => spawnSync(t, ["--version"]).status === 0,
);

describe("debug information", () => {
  it.skipIf(!dwarfdump)("maps native code to the .lucent.ts source lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-dbg-"));
    const src = path.join(dir, "sample.lucent.ts");
    fs.writeFileSync(
      src,
      "export function add(a: number, b: number): number {\n  const c = a + b;\n  return c * 2;\n}\n",
    );
    const r = compile([src]);
    for (const [name, content] of r.files) fs.writeFileSync(path.join(dir, name), content);
    const obj = path.join(dir, "m_sample.o");
    const cc = spawnSync(
      "clang++",
      [
        "-std=c++20",
        "-g",
        "-c",
        `-I${path.join(runtimeDir(), "cpp")}`,
        `-I${dir}`,
        path.join(dir, "m_sample.cpp"),
        "-o",
        obj,
      ],
      { encoding: "utf8" },
    );
    expect(cc.stderr).toBe("");
    const lines = spawnSync(dwarfdump!, ["--debug-line", obj], { encoding: "utf8" }).stdout;
    // The line table names the source file by its canonical absolute path
    // (DWARF splits it into a directory and a name), so debuggers and crash
    // symbolication open the right file.
    expect(lines).toContain(`"${fs.realpathSync(dir).replace(/\\/g, "/")}"`);
    expect(lines).toContain('name: "sample.lucent.ts"');
  });
});
