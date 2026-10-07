import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { Codes, compile, docsUrl, Explanations, sdkAvailable } from "../src/index.ts";

function compileExample(files: Record<string, string>, views = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-explain-"));
  const paths = Object.entries(files).map(([name, source]) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  });
  if (views) process.env.LUCENT_VIEWS = "fabric";

  try {
    return compile(paths.filter((f) => /\.lucent\.tsx?$/.test(f)));
  } finally {
    if (views) delete process.env.LUCENT_VIEWS;
  }
}

describe("explanations", () => {
  it("explain every code", () => {
    for (const code of Object.values(Codes)) {
      const e = Explanations[code];
      expect(e, code).toBeDefined();
      for (const field of ["title", "summary", "details", "fix"] as const)
        expect(e[field].trim(), `${code} ${field}`).not.toBe("");
      expect(Object.keys(e.wrong).length, `${code} wrong`).toBeGreaterThan(0);
      expect(Object.keys(e.right).length, `${code} right`).toBeGreaterThan(0);
    }
  });

  describe.each(Object.entries(Explanations))("%s", (code, e) => {
    const missing = e.sdk && !sdkAvailable(e.sdk);
    it.skipIf(missing)("its wrong example reports it", () => {
      const r = compileExample(e.wrong, e.views);
      const reported = e.severity === "warning" ? (r.warnings ?? []) : r.diagnostics;
      expect(reported.map((d) => d.code)).toContain(code);
    });
    it.skipIf(missing)("its right example compiles", () => {
      const r = compileExample(e.right, e.views);
      expect(r.diagnostics).toEqual([]);
      expect(r.warnings ?? []).toEqual([]);
    });
  });
});

describe("diagnostics", () => {
  it("carry the fix and where the code is explained", () => {
    const [d] = compileExample({
      "a.lucent.ts": "export function f(): number {\n  var x = 1;\n  return x;\n}\n",
    }).diagnostics;
    expect(d).toMatchObject({
      code: "LUCENT1001",
      fix: Explanations.LUCENT1001.fix,
      docs: docsUrl("LUCENT1001"),
    });
    expect(docsUrl("LUCENT1001")).toBe("https://lucent-lang.dev/docs/api/diagnostics/#lucent1001");
  });
});

describe("summaries name constructs that report their code", () => {
  // Each construct a code's summary names, with the code it reports today.
  it.each([
    ["LUCENT1001", "`var`", "export function f(): number {\n  var x = 1;\n  return x;\n}\n"],
    [
      "LUCENT1001",
      "a getter in an object literal",
      "export function f(): number {\n  const o = {\n    get x(): number {\n      return 1;\n    },\n  };\n  return o.x;\n}\n",
    ],
    [
      "LUCENT1001",
      "`await using`",
      "class R {\n  [Symbol.dispose](): void {}\n}\nexport async function f(): Promise<number> {\n  await using r = new R();\n  void r;\n  return 1;\n}\n",
    ],
    [
      "LUCENT1002",
      "`delete` of a field",
      "export function f(o: { a?: number }): number {\n  delete o.a;\n  return 1;\n}\n",
    ],
    [
      "LUCENT1002",
      "`instanceof` with a generic class",
      "class Box<T> {\n  constructor(public v: T) {}\n}\nexport function f(): boolean {\n  const b: Box<number> | undefined = new Box(1);\n  return b instanceof Box;\n}\n",
    ],
    [
      "LUCENT1002",
      "`in` on a class instance",
      'class K {\n  a = 1;\n}\nexport function f(): boolean {\n  const k = new K();\n  return "a" in k;\n}\n',
    ],
    [
      "LUCENT1002",
      "`in` on an object type's optional field",
      'type P = { x: number; y?: number };\nexport function f(p: P): boolean {\n  return "y" in p;\n}\n',
    ],
    [
      "LUCENT1005",
      "a static block",
      "class C {\n  static x = 1;\n  static {\n    C.x = 2;\n  }\n}\nexport function f(): number {\n  return C.x;\n}\n",
    ],
    [
      "LUCENT1005",
      "a decorator",
      "function sealed(_t: typeof A): void {}\n@sealed\nexport class A {}\n",
    ],
    [
      "LUCENT1007",
      "spread arguments to a fixed number of parameters",
      "function add(a: number, b: number): number {\n  return a + b;\n}\nexport function f(): number {\n  const t: [number, number] = [1, 2];\n  return add(...t);\n}\n",
    ],
    [
      "LUCENT2002",
      "a rest parameter in a function type",
      "export function f(sum: (...xs: number[]) => number): number {\n  return sum(1, 2, 3);\n}\n",
    ],
    [
      "LUCENT2002",
      "an async generator",
      "async function* g(): AsyncGenerator<number> {\n  yield 1;\n}\nexport function f(): number {\n  void g;\n  return 1;\n}\n",
    ],
    [
      "LUCENT3003",
      "an export list",
      "function twice(n: number): number {\n  return n * 2;\n}\nexport { twice };\n",
    ],
    [
      "LUCENT3003",
      "a default-exported function",
      "export default function twice(n: number): number {\n  return n * 2;\n}\n",
    ],
  ])("%s: %s", (code, _construct, source) => {
    const r = compileExample({ "sample.lucent.ts": source });
    expect(r.diagnostics.map((d) => d.code)).toContain(code);
  });
});

describe("fixes fit the construct reported", () => {
  // The fix the CLI prints under a diagnostic: the site's own when the
  // code's general fix is about something else.
  it.each([
    [
      "LUCENT1005",
      "a decorator",
      "function sealed(_t: typeof A): void {}\n@sealed\nexport class A {}\n",
      "decorator",
    ],
    [
      "LUCENT1005",
      "a static block",
      "class C {\n  static x = 1;\n  static {\n    C.x = 2;\n  }\n}\nexport function f(): number {\n  return C.x;\n}\n",
      "initializer",
    ],
    [
      "LUCENT2002",
      "a rest parameter in a function type",
      "export function f(sum: (...xs: number[]) => number): number {\n  return sum(1, 2);\n}\n",
      "array",
    ],
    [
      "LUCENT2002",
      "an async generator",
      "export class G {\n  async *g(): AsyncGenerator<number> {\n    yield 1;\n  }\n}\n",
      "generator",
    ],
  ])("%s: %s", (code, _construct, source, fix) => {
    const r = compileExample({ "sample.lucent.ts": source });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code, fix: expect.stringContaining(fix) }),
    );
  });
});
