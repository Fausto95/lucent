import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { cppOf, inOrder, module } from "./compile.ts";

const CASES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/cases");

const SAMPLE = `let made = 0;
function count(): number {
  return ++made;
}
let last: number;
const names: string[] = [];
export class Base {
  tag = "base";
  constructor(readonly id: number) {
    names.push(this.tag);
  }
}
export class Derived extends Base {
  static first = count();
  extra = this.id * 2;
  constructor(id: number) {
    super(id + 1);
    names.push(String(this.extra));
  }
}
export function run(): number {
  last = new Derived(1).extra;
  return last;
}
`;

/** A definition in `cpp`, from the line naming `name` to its closing brace. */
function definition(cpp: string, name: string): string {
  const start = cpp.search(new RegExp(`${name}\\(.*\\) \\{$`, "m"));

  expect(start).toBeGreaterThanOrEqual(0);

  return cpp.slice(start, cpp.indexOf("\n}\n", start) + 2);
}

describe("construction in the IR", () => {
  it("initializes parameter properties and fields before the constructor's body", () => {
    const out = cppOf(module(SAMPLE));

    const base = definition(out, "C_Base::construct");

    expect(inOrder(base, "this->r_id_ = p0_", "this->tag = ", ".push(")).toBe(true);
  });

  it("initializes a derived class's fields right after super()", () => {
    const derived = definition(cppOf(module(SAMPLE)), "C_Derived::construct");

    expect(inOrder(derived, "C_Base::construct(", "this->extra = ", ".push(")).toBe(true);

    expect(derived).toMatch(/this->extra = v\d+_;/);
  });

  it("initializes a module's static fields, then its variables, a variable without a value to its type's default", () => {
    const init = definition(cppOf(module(SAMPLE)), "m_sample::init");

    expect(
      inOrder(
        init,
        "C_Derived::first = ",
        "lucent_app::m_sample::made = 0.0;",
        "lucent_app::m_sample::last = ",
        "lucent_app::m_sample::names = ",
      ),
    ).toBe(true);
  });

  it("constructs an implicit constructor's base on its arguments, then its fields", () => {
    const file = module(`class Base {
  constructor(readonly id: number) {}
}
export class Leaf extends Base {
  tags: string[] = [];
}
export function make(): number {
  return new Leaf(3).tags.length;
}
`);
    const leaf = definition(cppOf(file), "C_Leaf::construct");

    expect(leaf).toMatch(/^C_Leaf::construct\(double p0_\) \{/);

    expect(inOrder(leaf, "C_Base::construct(p0_);", "this->tags = v")).toBe(true);
  });

  it("compiles the classes and inheritance cases, constructors and all, without a diagnostic", () => {
    for (const name of ["classes", "inheritance"]) {
      const r = compile([path.join(CASES, `${name}.lucent.ts`)]);

      expect(r.diagnostics).toEqual([]);
    }
  });
});
