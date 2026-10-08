import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir } from "../src/index.ts";

const dwarfdump = ["llvm-dwarfdump", "dwarfdump"].find(
  (t) => spawnSync(t, ["--version"]).status === 0,
);

/** Statements spanning lines, apart by blank lines a drifting line would land on. */
const SAMPLE = `export function add(a: number, b: number): number {
  const c = a + b;

  return c * 2;
}

export function sum(xs: number[]): number {
  let s = 0;

  for (const x of xs) {
    s += x;
  }

  const point = {
    x: s,
    y: s * 2,
  };

  const g = (k: number) => {
    return k + point.y;
  };

  return g(s);
}
`;

/** The source line ranges of every statement in `text` (1-based, inclusive). */
function statementSpans(text: string): [number, number][] {
  const sf = ts.createSourceFile("sample.lucent.ts", text, ts.ScriptTarget.Latest, true);
  const spans: [number, number][] = [];
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isStatement(n) || ts.isFunctionDeclaration(n))
      spans.push([line(n.getStart(sf)), line(n.getEnd())]);
    n.forEachChild(visit);
  };
  visit(sf);
  return spans;
}

/** Each row of the line table: its line and the name of its file. */
function lineRows(dump: string): { line: number; file: string }[] {
  const names = new Map<number, string>();
  for (const m of dump.matchAll(/file_names\[\s*(\d+)\]:\s*\n\s*name: "([^"]*)"/g))
    names.set(Number(m[1]), m[2]!);
  const rows: { line: number; file: string }[] = [];
  for (const m of dump.matchAll(/^0x[0-9a-f]+\s+(\d+)\s+\d+\s+(\d+)\s/gm))
    rows.push({ line: Number(m[1]), file: names.get(Number(m[2])) ?? "?" });
  return rows;
}

/** SAMPLE compiled with debug information: its object file and line table. */
function built(options: { root?: boolean } = {}): {
  dir: string;
  obj: string;
  dump: string;
  files: Map<string, string>;
} {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-dbg-")));
  const src = path.join(dir, "sample.lucent.ts");
  fs.writeFileSync(src, SAMPLE);
  const r = compile([src], options.root ? { root: dir } : {});
  for (const [name, content] of r.files) fs.writeFileSync(path.join(dir, name), content);
  const obj = path.join(dir, "m_sample.o");
  const cc = spawnSync(
    "clang++",
    [
      "-std=c++20",
      "-g",
      "-c",
      ...(options.root ? [`-ffile-prefix-map=${dir}=.`] : []),
      `-I${path.join(runtimeDir(), "cpp")}`,
      `-I${dir}`,
      path.join(dir, "m_sample.cpp"),
      "-o",
      obj,
    ],
    { encoding: "utf8", cwd: dir },
  );
  expect(cc.stderr).toBe("");
  const dump = spawnSync(dwarfdump!, ["--debug-line", obj], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }).stdout;
  return { dir, obj, dump, files: r.files };
}

describe("debug information", () => {
  it.skipIf(!dwarfdump)("maps every line of native code into a statement of the source", () => {
    const { dump } = built();
    const spans = statementSpans(SAMPLE);
    const mapped = lineRows(dump).filter((r) => r.file === "sample.lucent.ts" && r.line > 0);

    expect(mapped.length).toBeGreaterThan(10);
    const outside = mapped.filter((r) => !spans.some(([a, b]) => r.line >= a && r.line <= b));
    expect(outside.map((r) => r.line)).toEqual([]);
    // Every statement with code has some.
    for (const l of [2, 4, 8, 10, 11, 14, 19, 20, 23])
      expect(mapped.some((r) => r.line === l)).toBe(true);
  });

  it.skipIf(!dwarfdump)("names the source relative to the project, no machine path", () => {
    const { dir, obj, dump, files } = built({ root: true });

    // Debuggers and crash symbolication find it from the project's directory.
    expect(dump).toContain('name: "sample.lucent.ts"');
    expect(fs.readFileSync(obj).includes(dir)).toBe(false);
    // Nor do the error and trace sites, which are strings: no generated file names the directory.
    expect([...files].filter(([, text]) => text.includes(dir)).map(([name]) => name)).toEqual([]);
    expect(files.get("lucent_bindings.cpp")).toContain(
      'LUCENT_TRACE_SITE_AT("add", "sample.lucent.ts"',
    );
  });
});
