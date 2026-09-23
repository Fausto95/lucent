import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.ts";

// Rebuilds compare sources in the same directory, as a project would.
function build(sources: Record<string, string>, dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"))) {
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
const b = 'import { twice } from "./a.lucent";\nexport function quad(n: number): number { return twice(twice(n)); }';
const c = "export function hello(): string { return 'hi'; }";

describe("generated files for incremental native builds", () => {
  it("gives each module a header that includes only what it imports", () => {
    const files = build({ a, b, c });
    expect([...files.keys()].sort()).toEqual(["lucent_app.h", "lucent_bindings.cpp", "m_a.cpp", "m_a.h", "m_b.cpp", "m_b.h", "m_c.cpp", "m_c.h"]);
    expect(files.get("m_b.h")).toContain('#include "m_a.h"');
    expect(files.get("m_a.h")).not.toContain('#include "m_b.h"');
    expect(files.get("m_c.h")).not.toMatch(/#include "m_[ab]\.h"/);
    expect(files.get("m_b.cpp")).toContain('#include "m_b.h"');
  });

  it("changes only the module's own files when a function body changes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    const before = build({ a, b, c }, dir);
    const after = build({ a: a.replace("n * 2", "n + n"), b, c }, dir);
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(changed).toEqual(["m_a.cpp"]);
  });

  it("leaves unrelated headers alone when a module's exports change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-inc-"));
    const before = build({ a, b, c }, dir);
    const after = build({ a: `${a}\nexport function thrice(n: number): number { return n * 3; }`, b, c }, dir);
    const changed = [...before.keys()].filter((k) => before.get(k) !== after.get(k)).sort();
    expect(changed).toEqual(["lucent_bindings.cpp", "m_a.cpp", "m_a.h"]);
  });
});
