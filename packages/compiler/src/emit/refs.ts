/**
 * Each class's and struct's `lucentRefs_`: the strong references it holds,
 * field by field, for a debug build's cycle report (lucent/refs.h). The
 * runtime's `lucent::debug::refs` finds the references a field's value
 * holds (an object, the objects in an array or a map); a field of plain
 * data reports none. Emitted in every build, so the classes' layouts never
 * depend on NDEBUG; only a debug host walks them.
 */
import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import type { LType } from "../types.ts";

/** Kinds of value that never hold a strong reference to an object: their fields report nothing. */
const PLAIN = new Set<LType["k"]>([
  "number",
  "boolean",
  "string",
  "bigint",
  "null",
  "undefined",
  "void",
  "never",
  "date",
  "regexp",
  "bytes",
  "typed",
  "dataView",
  "arrayBuffer",
]);

/** Whether a field of type `t` may hold a strong reference to an object. */
export function mayRefer(t: LType): boolean {
  return !PLAIN.has(t.k);
}

/** `(lucent::debug::RefSink& s)`. */
export const refsParams = [cpp.param(cpp.reference(cpp.type("lucent::debug::RefSink")), "s")];

/** The method's declaration in a class or struct: it overrides lucent::Object's. */
export const refsMethod = (): cpp.Member => ({
  ...cpp.method("lucentRefs_", cpp.voidType, refsParams, undefined, { override: true }),
  const: true,
});

/** A field to report: its C++ member, its name as TypeScript writes it, and where it is declared. */
export interface RefField {
  member: string;
  label: string;
  where: string;
}

/** Where `node` is, as a report names it: `camera.lucent.ts:12`. */
export function siteOf(node: ts.Node): string {
  const sf = node.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${path.basename(sf.fileName)}:${line + 1}`;
}

/**
 * The method's inline definition: a base class's references first, then
 * each field's.
 */
export function refsDefinition(
  self: cpp.Type,
  fields: RefField[],
  opts: { base?: cpp.Type; template?: string[] } = {},
): cpp.Decl {
  const s = cpp.id("s");
  const body: cpp.Stmt[] = [
    ...(opts.base ? [cpp.exprStmt(cpp.call(cpp.scoped(opts.base, "lucentRefs_"), [s]))] : []),
    ...fields.map((f) =>
      cpp.exprStmt(
        cpp.call("lucent::debug::refs", [
          s,
          cpp.arrow(cpp.self, f.member),
          cpp.str(f.label),
          cpp.str(f.where),
        ]),
      ),
    ),
  ];
  if (!body.length) body.push(cpp.exprStmt(cpp.cast("c", cpp.voidType, s)));

  const fn = cpp.fn("lucentRefs_", cpp.voidType, refsParams, body, {
    scope: self,
    inline: true,
    ...(opts.template?.length ? { template: opts.template } : {}),
  }) as cpp.Decl & { k: "function" };

  return { ...fn, const: true };
}

/** How a report names a struct: its alias's or interface's name, or "object" for a literal's type. */
export function structLabel(cppName: string): string {
  const name = cppName.replace(/^S_/, "");
  return /^Object_[0-9a-f]+$/.test(name) || name === "" ? "object" : name;
}
