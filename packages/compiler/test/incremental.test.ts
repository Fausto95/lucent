import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, CompileSession } from "../src/index.ts";
import { declarationCacheSize } from "../src/program.ts";

// Rebuilds compare sources in the same directory, as a project would.
function build(
  sources: Record<string, string>,
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-")),
) {
  const files = Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, `${name}.lucent.ts`);
    fs.writeFileSync(f, src);
    return f;
  });
  const r = compile(files);
  expect(r.diagnostics).toEqual([]);
  return r.files;
}

const a = "export function twice(n: number): number { return n * 2; }";
const b =
  'import { twice } from "./a.lucent";\nexport function quad(n: number): number { return twice(twice(n)); }';
const c = "export function hello(): string { return 'hi'; }";

describe("generated files for incremental native builds", () => {
  it("gives each module a header that includes only what it imports", () => {
    const files = build({ a, b, c });
    expect([...files.keys()].sort()).toEqual([
      "lucent_app.h",
      "lucent_bindings.cpp",
      "lucent_identity.cpp",
      "m_a.cpp",
      "m_a.h",
      "m_b.cpp",
      "m_b.h",
      "m_c.cpp",
      "m_c.h",
    ]);
    expect(files.get("m_b.h")).toContain('#include "m_a.h"');
    expect(files.get("m_a.h")).not.toContain('#include "m_b.h"');
    expect(files.get("m_c.h")).not.toMatch(/#include "m_[ab]\.h"/);
    expect(files.get("m_b.cpp")).toContain('#include "m_b.h"');
  });

  it("changes only the module's own files when a function body changes, and the program's identity", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    const before = build({ a, b, c }, dir);
    const after = build({ a: a.replace("n * 2", "n + n"), b, c }, dir);
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k)).sort();
    expect(changed).toEqual(["lucent_identity.cpp", "m_a.cpp"]);
  });

  it("leaves unrelated headers alone when a module's exports change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    const before = build({ a, b, c }, dir);
    const after = build(
      { a: `${a}\nexport function thrice(n: number): number { return n * 3; }`, b, c },
      dir,
    );
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k)).sort();
    expect(changed).toEqual(["lucent_bindings.cpp", "lucent_identity.cpp", "m_a.cpp", "m_a.h"]);
  });
});

describe("checks that reuse the last program", () => {
  const write = (dir: string, name: string, src: string) => {
    const f = path.join(dir, `${name}.lucent.ts`);
    fs.writeFileSync(f, src);
    return f;
  };

  it("parse again only what changed, and report as a fresh compile does", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-session-"));
    const files = [write(dir, "a", a), write(dir, "b", b), write(dir, "c", c)];
    const session = new CompileSession();

    expect(compile(files, { session }).diagnostics).toEqual([]);

    const first = session.programs.get("program")!;

    write(dir, "c", "export function hello(): string { return 1; }");

    const again = compile(files, { session });
    const fresh = compile(files);

    expect(again.diagnostics).toEqual(fresh.diagnostics);
    expect(again.diagnostics.map((d) => d.code)).toEqual(["LUCENT9001"]);

    const second = session.programs.get("program")!;

    expect(second).not.toBe(first);
    // The unchanged modules and the library are the same parsed files.
    for (const f of [files[0]!, files[1]!])
      expect(second.getSourceFile(f)).toBe(first.getSourceFile(f));
    expect(second.getSourceFile(files[2]!)).not.toBe(first.getSourceFile(files[2]!));
    expect(again.read.get(files[2]!)).toBe(fresh.read.get(files[2]!));

    write(dir, "c", c);

    const fixed = compile(files, { session });

    expect(fixed.diagnostics).toEqual([]);
    expect([...fixed.files.keys()].sort()).toEqual([...compile(files).files.keys()].sort());
  });

  it("resolve again when a file resolution looked at changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-session-"));
    const user = write(
      dir,
      "user",
      'import { twice } from "./lib/a.lucent";\nexport function f(): number { return twice(2); }\n',
    );
    const session = new CompileSession();

    expect(compile([user], { session }).diagnostics.map((d) => d.code)).toContain("LUCENT9001");

    fs.mkdirSync(path.join(dir, "lib"));
    const lib = write(path.join(dir, "lib"), "a", a);

    expect(compile([user, lib], { session }).diagnostics).toEqual([]);
  });

  it("keep the declaration cache bounded", () => {
    expect(declarationCacheSize()).toBeLessThanOrEqual(4000);
  });
});

/** The generated files `unit` reads: itself and every generated header it includes, transitively. */
function closure(files: Map<string, string>, unit: string): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (name: string) => {
    const text = files.get(name);
    if (text === undefined || seen.has(name)) return;
    seen.set(name, text);
    for (const [, inc] of text.matchAll(/^#include "([^"]+)"/gm)) visit(inc!);
  };
  visit(unit);
  return seen;
}

/** The units whose inputs differ between two builds: what a native build compiles again. */
function rebuilt(before: Map<string, string>, after: Map<string, string>): string[] {
  const units = [...after.keys()].filter((f) => f.endsWith(".cpp"));
  return units
    .filter((u) => {
      const [x, y] = [closure(before, u), closure(after, u)];
      return x.size !== y.size || [...x].some(([k, v]) => y.get(k) !== v);
    })
    .sort();
}

describe("the types' headers", () => {
  const point = (fields: string) => `export interface Point { ${fields} }
export function norm(p: Point): number { return Math.hypot(p.x, p.y); }
export function origin(): Point { return { x: 0, y: 0 } as Point; }`;
  const label = `export interface Label { text: string; size: number }
export class Tag { constructor(public label: Label) {} }
export function tag(text: string): Tag { return new Tag({ text, size: text.length }); }
export function render(t: Tag): string { return JSON.stringify(t.label); }`;
  const user = `import { norm, origin } from "./point.lucent";
export function far(): number { return norm(origin()) + 1; }`;
  const anonymous = `export function pair(n: number): { first: number; second: number } {
  return { first: n, second: n + 1 };
}
export function sum(n: number): number { const p = pair(n); return p.first + p.second; }`;

  it("recompiles only the units that use a struct when its shape changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    const sources = { point: point("x: number; y: number"), label, user, anonymous };
    const before = build(sources, dir);
    const after = build({ ...sources, point: point("x: number; y: number; z?: number") }, dir);
    expect(rebuilt(before, after)).toEqual([
      "lucent_bindings.cpp",
      "lucent_identity.cpp",
      "m_point.cpp",
      "m_user.cpp",
    ]);
  });

  it("names an object type by its shape, so another module's new one renames none", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    // A type and no new temporaries: the compiler numbers those in the program's order.
    const extra = `export function unbox(b: { value: number }): number { return b.value; }\n`;
    const sources = { point: point("x: number; y: number"), label, user, anonymous };
    const before = build(sources, dir);
    const after = build({ ...sources, point: `${extra}${sources.point}` }, dir);
    expect(rebuilt(before, after)).toEqual([
      "lucent_bindings.cpp",
      "lucent_identity.cpp",
      "m_point.cpp",
      "m_user.cpp",
    ]);
  });

  it("recompiles only a class's users when its fields change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    const sources = { point: point("x: number; y: number"), label, user, anonymous };
    const before = build(sources, dir);
    const after = build(
      {
        ...sources,
        label: label.replace("public label: Label", "public label: Label, public n = 1"),
      },
      dir,
    );
    expect(rebuilt(before, after)).toEqual([
      "lucent_bindings.cpp",
      "lucent_identity.cpp",
      "m_label.cpp",
    ]);
  });
});
