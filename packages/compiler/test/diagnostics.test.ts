import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

function compileSource(source: string, name = "sample") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-diag-"));
  const file = path.join(dir, `${name}.lucent.ts`);
  fs.writeFileSync(file, source);
  return compile([file]);
}

/** `source` with `edits` applied, the last first. */
function applied(
  source: string,
  edits: readonly { start: number; length: number; text: string }[],
) {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.start + e.length), source);
}

function codes(source: string): string[] {
  return compileSource(source).diagnostics.map((d) => d.code);
}

describe("diagnostics", () => {
  it("accepts a simple module", () => {
    const r = compileSource("export function add(a: number, b: number): number { return a + b; }");
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
    expect([...r.files.keys()]).toContain("lucent_app.h");
  });

  it("accepts renamed imports of core helpers", () => {
    expect(
      codes(
        'import { errorCode as codeOf } from "lucent:core";\nexport function f(e: Error): string { return codeOf(e) ?? "none"; }',
      ),
    ).toEqual([]);
  });

  it("rejects the old @lucent-lang/core specifier", () => {
    const r = compileSource(
      'import { errorCode } from "@lucent-lang/core";\nexport function f(e: Error): string { return errorCode(e) ?? "none"; }',
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({
      line: 1,
      message: expect.stringContaining("@lucent-lang/core"),
    });
  });

  it("accepts console", () => {
    expect(
      codes('export function f(n: number): void { console.log("n", n); console.warn(`w${n}`); }'),
    ).toEqual([]);
  });

  it("reports TypeScript errors first", () => {
    expect(codes("export function f(): number { return 'x'; }")).toEqual(["LUCENT9001"]);
  });

  it("rejects any", () => {
    expect(codes("export function f(x: any): number { return 1; }")).toContain("LUCENT2001");
  });

  it("reports two modules with one name under their own code", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-diag-"));
    const files = ["screens", "sdk"].map((sub) => {
      fs.mkdirSync(path.join(dir, sub));
      const file = path.join(dir, sub, "clock.lucent.ts");
      fs.writeFileSync(file, "export function now(): number { return 1; }\n");
      return file;
    });

    const r = compile(files);

    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({
      code: "LUCENT3010",
      file: files[1],
      message: expect.stringContaining('two Lucent modules are named "clock"'),
      fix: expect.stringContaining("rename"),
    });
  });

  it("rejects imports of other packages", () => {
    expect(codes('import fs from "node:fs";\nexport function f(): number { return 1; }')).toEqual(
      expect.arrayContaining([expect.stringMatching(/LUCENT(3001|9001)/)]),
    );
  });

  it("rejects top-level statements", () => {
    expect(codes("export function f(): number { return 1; }\nf();")).toContain("LUCENT3002");
  });

  it("rejects var", () => {
    expect(codes("export function f(): number { var x = 1; return x; }")).toContain("LUCENT1001");
  });

  it("rejects await using and using directly in a case clause", () => {
    const resource = "class R { [Symbol.dispose](): void {} }\n";
    const awaited = compileSource(
      `${resource}export async function f(): Promise<void> { await using r = new R(); }`,
    );
    expect(awaited.diagnostics[0]).toMatchObject({
      code: "LUCENT1001",
      message: expect.stringContaining("`await using` is not supported"),
    });
    const inCase = compileSource(
      `${resource}export function f(n: number): void { switch (n) { case 1: using r = new R(); } }`,
    );
    expect(inCase.diagnostics[0]).toMatchObject({
      code: "LUCENT1001",
      message: expect.stringContaining("in a case clause in a block"),
    });
  });

  it("rejects computed member names other than Symbol.dispose", () => {
    const r = compileSource(
      'const key = "k";\nexport class C { ["x" + key](): number { return 1; } }',
    );
    expect(r.diagnostics[0]).toMatchObject({
      code: "LUCENT1005",
      message: expect.stringContaining("but for [Symbol.dispose]"),
    });
  });

  it("reports only the rejected var, not the uses of its variable", () => {
    const src =
      "export function total(xs: number[]): number {\n  var sum = 0;\n  for (const x of xs) sum += x;\n  return sum;\n}\n";
    expect(codes(src)).toEqual(["LUCENT1001"]);
  });

  it("reports only a rejected top-level var, not the uses of its variable", () => {
    expect(codes("var g = 1;\nexport function f(): number { g += 1; return g; }")).toEqual([
      "LUCENT3002",
    ]);
  });

  it("reports only a top-level destructuring, not the uses of its names", () => {
    expect(codes("const { a } = { a: 1 };\nexport function f(): number { return a; }")).toEqual([
      "LUCENT3002",
    ]);
  });

  it("reports only the type of a top-level variable, not the uses of it", () => {
    expect(codes("let g: any = 1;\nexport function f(): number { g = 2; return g; }")).toEqual([
      "LUCENT2001",
    ]);
  });

  it("rejects getters in object literals", () => {
    expect(
      codes("export function f(): number { const o = { get x() { return 1; } }; return o.x; }"),
    ).toEqual(["LUCENT1001"]);
  });

  it("rejects setters in object literals", () => {
    expect(
      codes(
        "export function f(): number { let v = 0; const o = { set x(n: number) { v = n; } }; o.x = 1; return v; }",
      ),
    ).toEqual(["LUCENT1001"]);
  });

  it("rejects getters in object literals of a declared type", () => {
    expect(
      codes(
        "type P = { x: number };\nexport function f(): number { const o: P = { get x() { return 1; } }; return o.x; }",
      ),
    ).toEqual(["LUCENT1001"]);
  });

  describe("spreads into a record literal", () => {
    const spread = (decls: string, type: string) =>
      compileSource(
        `${decls}\nexport function f(v: ${type}): number {\n  const r: Record<string, number | undefined> = { ...v };\n  return Object.keys(r).length;\n}\n`,
      ).diagnostics;

    it("accepts a record", () => {
      expect(spread("", "Record<string, number | undefined>")).toEqual([]);
    });

    it("accepts a record that may be undefined", () => {
      expect(spread("", "Record<string, number | undefined> | undefined")).toEqual([]);
    });

    it.each([
      ["an object type", "type P = { a: number; b?: number };", "P"],
      ["a class instance", "class C { a = 1; b?: number; }", "C"],
      ["an interface", "interface I { a: number; b?: number }", "I"],
    ])("rejects %s, which has no key order nor set of present keys", (_, decls, type) => {
      expect(spread(decls, type)).toEqual([
        expect.objectContaining({
          code: "LUCENT1001",
          line: 3,
          message: expect.stringContaining("only records can be spread into a record literal"),
        }),
      ]);
    });

    it("rejects a record of another value type", () => {
      expect(spread("", "Record<string, number>")).toEqual([
        expect.objectContaining({ code: "LUCENT2004" }),
      ]);
    });
  });

  it("rejects throwing non-errors", () => {
    expect(codes('export function f(): number { throw "nope"; }')).toContain("LUCENT1006");
  });

  it("fixes a thrown string by making it an Error's message", () => {
    const source = 'export function f(): number { throw "nope"; }';
    const [d] = compileSource(source).diagnostics;

    expect(d!.quickFix?.title).toBe('Throw new Error("nope")');
    const fixed = applied(source, d!.quickFix!.edits);
    expect(fixed).toBe('export function f(): number { throw new Error("nope"); }');
    expect(compileSource(fixed).diagnostics).toEqual([]);
  });

  it("offers no fix for a thrown value that is no string", () => {
    const [d] = compileSource("export function f(): number { throw 42; }").diagnostics;

    expect(d).toMatchObject({ code: "LUCENT1006" });
    expect(d!.quickFix).toBeUndefined();
  });

  it("rejects inexact object types", () => {
    const src = `type A = { x: number }; type B = { x: number; y: number };
function take(a: A): number { return a.x; }
export function f(b: B): number { return take(b); }`;
    expect(codes(src)).toContain("LUCENT2003");
  });

  it("rejects inexact object types in a union, rather than throwing at run time", () => {
    const src = `type Label = { name?: string; size?: number };
type Sized = { name: string; size: number };
type Titled = { size: number; title: string };
export function f(big: boolean, a: Sized, b: Titled): Label {
  const either = big ? a : b;

  return either;
}`;

    expect(codes(src)).toContain("LUCENT2003");
  });

  it("accepts a union converted member by member", () => {
    const src = `class Shape { area(): number { return 0; } }
class Square extends Shape { side = 1; }
class Circle extends Shape { radius = 1; }
export function f(round: boolean): number {
  const either = round ? new Circle() : new Square();
  const shape: Shape = either;

  return shape.area();
}`;

    expect(codes(src)).toEqual([]);
  });

  it("rejects exporting generic functions", () => {
    expect(codes("export function id<T>(x: T): T { return x; }")).toContain("LUCENT2007");
  });

  it("rejects ambiguous unions at the boundary", () => {
    const src =
      "type A = { a: number }; type B = { b: string };\nexport function f(x: A | B): number { return 1; }";
    expect(codes(src)).toContain("LUCENT2005");
  });

  it("accepts regular expressions", () => {
    expect(codes("export function f(s: string): boolean { return /a/.test(s); }")).toEqual([]);
  });

  it("rejects invalid regular expression literals", () => {
    expect(
      codes("export function f(s: string): boolean { return /(?<n>a)(?<n>b)/.test(s); }").length,
    ).toBeGreaterThan(0);
  });

  it("rejects extending built-in classes other than Error", () => {
    const src =
      "class B extends Map<string, number> {}\nexport function f(): number { return new B().size; }";
    expect(codes(src)).toContain("LUCENT1005");
  });

  it("rejects a toJSON that JSON.stringify would call with a key", () => {
    const src =
      "class P { toJSON(key: string): string { return key; } }\nexport function f(): string { return JSON.stringify(new P()); }";
    expect(codes(src)).toContain("LUCENT1005");
  });

  it("rejects overrides whose native signature differs", () => {
    const src =
      "class A { f(x: number): number { return x; } }\nclass B extends A { override f(x?: number): number { return 1; } }\nexport function g(): number { return new B().f(1); }";
    expect(codes(src)).toContain("LUCENT1005");
  });

  it("points at the source location", () => {
    const r = compileSource("export function f(): number {\n  var x = 1;\n  return x;\n}");
    const d = r.diagnostics.find((x) => x.code === "LUCENT1001");
    expect(d?.line).toBe(2);
  });

  describe("interfaces implemented by classes", () => {
    const shape = "interface Shape { area(): number; }\n";

    it("accepts a class that declares implements", () => {
      expect(
        codes(
          `${shape}class Sq implements Shape { area(): number { return 1; } }\nexport function f(): number { const s: Shape = new Sq(); return s.area(); }`,
        ),
      ).toEqual([]);
    });

    it("rejects a class that matches only structurally", () => {
      expect(
        codes(
          `${shape}class Sq { area(): number { return 1; } }\nexport function f(): number { const s: Shape = new Sq(); return s.area(); }`,
        ),
      ).toContain("LUCENT2008");
    });

    it("rejects an object literal for an interface with methods", () => {
      expect(
        codes(
          `${shape}export function f(): number { const s: Shape = { area: () => 1 }; return s.area(); }`,
        ),
      ).toContain("LUCENT2008");
    });

    it("rejects a method whose native signature differs", () => {
      expect(
        codes(
          `interface P { at(i: number): string | undefined; }\nclass Q implements P { at(i?: number): string { return "x"; } }\nexport function f(): number { return 1; }`,
        ),
      ).toContain("LUCENT2009");
    });

    it("accepts generic interfaces implemented by classes", () => {
      expect(
        codes(
          `interface Box<T> { get(): T; }\nclass N implements Box<number> { get(): number { return 1; } }\nexport function f(): number { const b: Box<number> = new N(); return b.get(); }`,
        ),
      ).toEqual([]);
    });

    it("rejects a class used through an interface instantiation it does not implement", () => {
      expect(
        codes(
          `interface Box<T> { get(): T | undefined; }\nclass N implements Box<number> { get(): number | undefined { return 1; } }\nexport function f(): number { const b: Box<string> = new N() as unknown as Box<string>; return 1; }`,
        ),
      ).not.toEqual([]);
    });
  });

  describe("AbortSignal", () => {
    it("accepts signals from JavaScript", () => {
      expect(codes("export function f(s: AbortSignal): boolean { return s.aborted; }")).toEqual([]);
    });

    it("rejects returning a signal to JavaScript", () => {
      expect(
        codes("export function f(): AbortSignal { return new AbortController().signal; }"),
      ).toContain("LUCENT2006");
    });

    it("rejects abort reasons that are not errors", () => {
      expect(codes('export function f(): void { new AbortController().abort("stop"); }')).toContain(
        "LUCENT1003",
      );
    });

    it("rejects reading the untyped reason", () => {
      expect(
        codes("export function f(s: AbortSignal): boolean { return s.reason === undefined; }"),
      ).toEqual(expect.arrayContaining([expect.stringMatching(/LUCENT(1003|2001)/)]));
    });
  });

  describe("integer inference", () => {
    const hash = `export function hash(input: string, seed: number = 0): number {
  let h = seed | 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}`;
    const cpp = (src: string) => compileSource(src).files.get("m_sample.cpp") ?? "";

    it("keeps int32 locals and loop counters in integer registers", () => {
      const out = cpp(hash);
      expect(out).toMatch(/int32_t h = /);
      expect(out).toMatch(/int64_t i = /);
    });

    it("leaves locals with fractional or non-bitwise writes as doubles", () => {
      const out = cpp(
        "export function f(x: number): number {\n  let a = x | 0;\n  a += 1;\n  let z = 0;\n  z = -0;\n  return a + z;\n}",
      );
      expect(out).toMatch(/double a = /);
      expect(out).toMatch(/double z = /);
    });
  });

  describe("JSON.parse", () => {
    it("accepts a target type from as or an annotation", () => {
      expect(
        codes(
          "export function f(s: string): number { const a = JSON.parse(s) as number[]; const b: { x: number } = JSON.parse(s); return a.length + b.x; }",
        ),
      ).toEqual([]);
    });

    it("needs a target type", () => {
      expect(
        codes("export function f(s: string): number { const v = JSON.parse(s); return v; }"),
      ).toEqual(expect.arrayContaining([expect.stringMatching(/LUCENT(1003|2001)/)]));
    });

    it("cannot create class instances", () => {
      expect(
        codes(
          "class P { x = 1; }\nexport function f(s: string): number { return (JSON.parse(s) as P).x; }",
        ),
      ).toContain("LUCENT1003");
    });
  });

  describe("decorators", () => {
    // Standard decorators replace or wrap what they decorate at run time:
    // compiling the class without running them would differ from JavaScript.
    it.each([
      [
        "a class",
        "function sealed(_t: typeof A): void {}\n@sealed\nexport class A {\n  x = 1;\n}\n",
        2,
        1,
      ],
      [
        "a method",
        "function logged(m: (this: B) => number): (this: B) => number {\n  return m;\n}\nexport class B {\n  @logged\n  m(): number {\n    return 1;\n  }\n}\n",
        5,
        3,
      ],
      [
        "a field",
        "function field(_v: undefined, _c: { kind: string }): void {}\nexport class F {\n  @field\n  x = 1;\n}\n",
        3,
        3,
      ],
      [
        "an accessor",
        "function getter(g: (this: G) => number): (this: G) => number {\n  return g;\n}\nexport class G {\n  @getter\n  get x(): number {\n    return 1;\n  }\n}\n",
        5,
        3,
      ],
    ])("rejects a decorator on %s at the decorator", (_what, source, line, column) => {
      const r = compileSource(source);
      expect(r.ok).toBe(false);
      expect(r.diagnostics).toContainEqual(
        expect.objectContaining({ code: "LUCENT1005", line, column }),
      );
    });

    it("leaves parameter decorators to TypeScript, which rejects them", () => {
      expect(
        codes(
          "function inject(_t: unknown, _k: string | undefined, _i: number): void {}\nexport class A {\n  constructor(@inject public x: number) {}\n}\n",
        ),
      ).toEqual(["LUCENT9001"]);
    });
  });

  describe("default exports", () => {
    // JavaScript would see these under their own names, not as `default`.
    it("rejects a default-exported function", () => {
      expect(
        codes("export default function twice(n: number): number {\n  return n * 2;\n}\n"),
      ).toEqual(["LUCENT3003"]);
    });

    it("rejects a default-exported class", () => {
      expect(codes("export default class Box {\n  v = 1;\n}\n")).toContain("LUCENT3003");
    });

    it("rejects an anonymous default-exported function as a default export", () => {
      expect(codes("export default function (n: number): number {\n  return n;\n}\n")).toEqual([
        "LUCENT3003",
      ]);
    });

    it("reports an anonymous default-exported class once", () => {
      expect(codes("export default class {\n  v = 1;\n}\n")).toEqual(["LUCENT3003"]);
    });
  });

  describe("presence of optional fields", () => {
    // An object type's optional field cannot tell unset from set to undefined.
    const P = "type P = { x: number; y?: number };\n";

    it("refuses `in` with an optional field", () => {
      expect(codes(`${P}export function f(p: P): boolean {\n  return "y" in p;\n}\n`)).toEqual([
        "LUCENT1002",
      ]);
    });

    it("refuses a dynamic `in` on a type with optional fields", () => {
      expect(
        codes(`${P}export function f(p: P, k: string): boolean {\n  return k in p;\n}\n`),
      ).toEqual(["LUCENT1002"]);
    });

    it("refuses for…in on a type with optional fields", () => {
      expect(
        codes(
          `${P}export function f(p: P): string {\n  let s = "";\n  for (const k in p) s += k;\n  return s;\n}\n`,
        ),
      ).toEqual(["LUCENT1009"]);
    });

    it("refuses Object.keys on a type with optional fields", () => {
      expect(
        codes(`${P}export function f(p: P): string[] {\n  return Object.keys(p);\n}\n`),
      ).toEqual(["LUCENT1003"]);
    });

    it("points `in` on a union at a discriminant", () => {
      const r = compileSource(
        'type Circle = { radius: number };\ntype Square = { side: number };\nfunction round(s: Circle | Square): boolean {\n  return "radius" in s;\n}\nexport function f(): boolean {\n  return round({ side: 1 });\n}\n',
      );
      expect(r.diagnostics).toEqual([
        expect.objectContaining({
          code: "LUCENT1002",
          message: expect.stringContaining("discriminant"),
        }),
      ]);
    });

    it.each([
      [
        "a class instance",
        'class K {\n  a = 1;\n}\nexport function f(): boolean {\n  return "a" in new K();\n}\n',
      ],
      ["an array", 'export function f(a: number[]): boolean {\n  return "length" in a;\n}\n'],
      ["a Map", 'export function f(m: Map<string, number>): boolean {\n  return "size" in m;\n}\n'],
    ])("names %s as what `in` refused", (what, source) => {
      const [d] = compileSource(source).diagnostics;
      expect(d).toMatchObject({ code: "LUCENT1002", message: expect.stringContaining(what) });
      expect(d!.message).not.toContain("discriminant");
    });
  });

  describe("lowering outside a function body", () => {
    it("reports an exported class's unsupported member once instead of throwing", () => {
      const source =
        "export class G {\n  async *g(): AsyncGenerator<number> {\n    yield 1;\n  }\n}\n";
      expect(() => compileSource(source)).not.toThrow();
      expect(codes(source)).toEqual(["LUCENT2002"]);
    });

    it("returns no files or proxies from a failing compile", () => {
      const r = compileSource(
        "function twice(n: number): number {\n  return n * 2;\n}\nexport default twice;\n",
      );
      expect(r.ok).toBe(false);
      expect(r.files.size).toBe(0);
      expect(r.proxies.size).toBe(0);
    });
  });

  describe("generators", () => {
    it("rejects returning a generator to JavaScript", () => {
      expect(codes("export function* f(): Generator<number> { yield 1; }")).toContain("LUCENT2006");
    });

    it("rejects using the value of yield", () => {
      expect(
        codes(
          "function* g(): Generator<number, void, number> { const x = yield 1; }\nexport function f(): number { g(); return 1; }",
        ),
      ).toContain("LUCENT1001");
    });
  });

  describe("string methods that need Unicode or locale data", () => {
    it.each([
      ["normalize()", "export function f(s: string): string { return s.normalize(); }"],
      ['normalize("NFD")', 'export function f(s: string): string { return s.normalize("NFD"); }'],
      [
        "toLocaleUpperCase(locale)",
        'export function f(s: string): string { return s.toLocaleUpperCase("tr"); }',
      ],
      [
        "toLocaleLowerCase(locales)",
        'export function f(s: string): string { return s.toLocaleLowerCase(["tr"]); }',
      ],
      [
        "localeCompare(other, locale)",
        'export function f(a: string, b: string): number { return a.localeCompare(b, "en"); }',
      ],
      [
        "localeCompare(other, undefined, options)",
        'export function f(a: string, b: string): number { return a.localeCompare(b, undefined, { sensitivity: "base" }); }',
      ],
    ])("rejects %s", (_, src) => {
      expect(codes(src)).toContain("LUCENT1003");
    });

    it("accepts the locale methods without a locale, for the device's", () => {
      expect(
        codes(
          "export function f(a: string, b: string): string { return `${a.toLocaleUpperCase()} ${a.toLocaleLowerCase()} ${a.localeCompare(b)}`; }",
        ),
      ).toEqual([]);
    });
  });

  describe("an error's cause", () => {
    it.each([
      [
        "new Error(message, { cause })",
        'export function f(e: Error): Error { return new Error("x", { cause: e }); }',
      ],
      [
        "new TypeError(message, { cause })",
        'export function f(e: Error): Error { return new TypeError("x", { cause: e }); }',
      ],
      [
        "super(message, { cause }) in an Error class",
        'class Wrapped extends Error {\n  constructor(m: string, c: Error) {\n    super(m, { cause: c });\n  }\n}\nexport function f(e: Error): Error { return new Wrapped("x", e); }',
      ],
      [
        "new on an Error class without a constructor of its own",
        'class Plain extends Error {}\nexport function f(e: Error): Error { return new Plain("x", { cause: e }); }',
      ],
    ])("rejects %s", (_, src) => {
      expect(codes(src)).toContain("LUCENT1003");
    });
  });

  it("rejects Array.isArray of an Iterable, which no longer knows its kind", () => {
    const src =
      "function g(x: Iterable<number>): boolean { return Array.isArray(x); }\nexport function f(): boolean { return g([1]); }";

    expect(compileSource(src).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LUCENT1003",
        message: expect.stringContaining("testing whether an Iterable is an Array"),
      }),
    );
  });

  describe("object types' keys, which record neither which optional fields are set nor their order", () => {
    const shape = "type P = { a: number; b?: number };\n";

    it.each([
      ["Object.keys", "export function f(p: P): string[] { return Object.keys(p); }", "LUCENT1003"],
      [
        "for…in",
        'export function f(p: P): string { let s = ""; for (const k in p) s += k; return s; }',
        "LUCENT1009",
      ],
      ["in", 'export function f(p: P): boolean { return "b" in p; }', "LUCENT1002"],
    ])("rejects %s on an object type", (_, src, code) => {
      expect(codes(shape + src)).toContain(code);
    });

    it.each(["values", "entries"])("names Object.%s's reason in words", (name) => {
      const src = `export function f(p: P): number { return Object.${name}(p).length; }`;

      expect(compileSource(shape + src).diagnostics).toContainEqual(
        expect.objectContaining({
          code: "LUCENT1003",
          message: expect.stringContaining(`Object.${name} of an object type is not supported`),
        }),
      );
    });
  });

  describe("arrays with holes, which Lucent arrays cannot hold", () => {
    it.each([
      ["new Array(n)", "export function f(): number[] { return new Array<number>(3); }"],
      [
        "new Array(n) of a type that admits undefined",
        "export function f(): (number | undefined)[] { return new Array<number | undefined>(3); }",
      ],
      [
        "new Array(n) filled in part",
        "export function f(): number[] { return new Array<number>(3).fill(0, 1); }",
      ],
      [
        "new Array(n) filled later",
        "export function f(n: number): number[] { const a = new Array<number>(n); a.fill(0); return a; }",
      ],
      [
        "new Array(x) of a number or an element",
        "export function f(x: number | string): (number | string)[] { return new Array<number | string>(x); }",
      ],
      [
        "Array.from({ length }) of elements that cannot be undefined",
        "export function f(): number[] { const c: number[] = Array.from({ length: 3 }); return c; }",
      ],
      [
        "Array.from of an array-like with elements",
        "export function f(): number[] { return Array.from({ length: 2, 0: 5 }, (v, i) => (v ?? 0) + i); }",
      ],
    ])("rejects %s", (_, src) => {
      expect(codes(src)).toContain("LUCENT1003");
    });

    it.each([
      [
        "new Array(n).fill(value)",
        "export function f(n: number): number[] { return new Array<number>(n).fill(0); }",
      ],
      [
        "Array.from({ length }) of elements that may be undefined",
        "export function f(n: number): (number | undefined)[] { const a: (number | undefined)[] = Array.from({ length: n }); return a; }",
      ],
      [
        "Array.from({ length }, map)",
        "export function f(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }",
      ],
    ])("accepts %s", (_, src) => {
      expect(codes(src)).toEqual([]);
    });
  });

  describe("new Proxy", () => {
    it("rejects a proxy of a class instance, rather than making another instance", () => {
      const r = compileSource(
        "class C {\n  n = 1;\n}\nexport function f(): number {\n  const c = new C();\n  const p = new Proxy(c, { get: () => 42 });\n  p.n = 5;\n  return c.n;\n}",
      );

      expect(r.diagnostics).toEqual([
        expect.objectContaining({
          code: "LUCENT1003",
          message: expect.stringContaining("new Proxy()"),
        }),
      ]);
    });

    it("rejects a proxy of a built-in", () => {
      expect(
        codes(
          "export function f(): number { const p = new Proxy(new Map<string, number>(), {}); return p.size; }",
        ),
      ).toContain("LUCENT1003");
    });
  });
});
