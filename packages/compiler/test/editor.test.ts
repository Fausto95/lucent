import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { checkSources } from "../src/index.ts";

function project(sources: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-editor-"));
  return Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, `${name}.lucent.ts`);
    fs.writeFileSync(f, src);
    return f;
  });
}

describe("checkSources (editor diagnostics)", () => {
  it("locates Lucent diagnostics by offset and length", () => {
    const [file] = project({ a: "export function f(): number {\n  var x = 1;\n  return x;\n}\n" });
    const [d] = checkSources([file!]);
    expect(d).toMatchObject({ code: "LUCENT1001", file, line: 2, column: 3 });
    const text = fs.readFileSync(file!, "utf8");
    expect(text.slice(d!.start, d!.start! + d!.length!)).toBe("var x = 1");
  });

  it("checks unsaved text instead of the file on disk", () => {
    const [file] = project({ a: "export function f(): number { return 1; }\n" });
    expect(checkSources([file!])).toEqual([]);
    const edited = "export function f(x: any): number { return 1; }\n";
    const [d] = checkSources([file!], (f) => (f === file ? edited : undefined));
    expect(d).toMatchObject({ code: "LUCENT2001", file });
  });

  it("checks a module in the context of the modules it imports", () => {
    const [a, b] = project({
      a: "export class Point { constructor(public x: number) {} }\n",
      b: 'import { Point } from "./a.lucent";\nexport function make(): Point { return new Point(1); }\n',
    });
    expect(checkSources([a!, b!])).toEqual([]);
  });
});
