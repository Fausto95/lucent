import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { module } from "./ir/compile.ts";

/** The structs a program's header declares, by name, with their fields as C++ spells them. */
function structs(source: string): Record<string, string> {
  const r = compile([module(source)]);

  expect(r.diagnostics).toEqual([]);

  const header = r.files.get("lucent_app.h")!.replace(/^#line .*\n/gm, "");
  const out: Record<string, string> = {};

  for (const m of header.matchAll(/^struct (\w+) : lucent::Object \{\n([\s\S]*?)\n\};/gm))
    out[m[1]!] = m[2]!.replace(/\s+/g, " ").trim();
  return out;
}

describe("struct shapes", () => {
  it("shares one struct between identical self-recursive shapes, through arrays and optionals", () => {
    const s = structs(`interface TreeNode { value: number; children: TreeNode[] }
type Tree = { value: number; children: Tree[] };
interface ListA { v: number; next?: ListA }
type ListB = { v: number; next?: ListB };
export function tree(t: TreeNode): Tree { return t; }
export function list(l: ListA): ListB { return l; }
`);

    expect(Object.keys(s).sort()).toEqual(["S_ListA", "S_TreeNode"]);
  });

  it("tells mutual recursion from self recursion with the same field names", () => {
    const s = structs(`interface X { n: number; other?: Y }
interface Y { n: string; other?: X }
interface S { n: number; other?: S }
export function x(v: X): number { return v.n; }
export function self(v: S): number { return v.n; }
`);

    expect(s.S_X).toContain("Opt<lucent::Ref<lucent_app::S_Y>> other");
    expect(s.S_S).toContain("Opt<lucent::Ref<lucent_app::S_S>> other");
  });

  it("shares a recursive shape declared once as a cycle and once as a self reference", () => {
    // A ring of two alike structs is the same shape as one struct holding itself.
    const s = structs(`interface A { n: number; next?: B }
interface B { n: number; next?: A }
interface C { n: number; next?: C }
export function ring(a: A): C { return a; }
`);

    expect(Object.keys(s)).toHaveLength(1);
  });

  it("shares a shape that refers to one registered before it", () => {
    const s = structs(`interface X { n: number; y?: Y }
interface Y { n: string; x?: X }
type Z = { n: string; x?: X };
export function f(y: Y): Z { return y; }
export function g(z: Z): Y { return z; }
`);

    expect(Object.keys(s).sort()).toEqual(["S_X", "S_Y"]);
  });

  it("keeps recursion through unions and maps", () => {
    const s = structs(`type Json = { tag: "num"; n: number } | { tag: "list"; items: Json[] };
type Doc = { name: string; kids: Map<string, Doc> | null };
export function sum(j: Json): number { return j.tag === "num" ? j.n : j.items.length; }
export function name(d: Doc): string { return d.name; }
`);

    expect(Object.values(s).join("\n")).toContain(
      "lucent::Map<lucent::String, lucent::Ref<lucent_app::S_Doc>>",
    );
  });
});
