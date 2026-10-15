/**
 * Native entry points (decision 0091): a C function for each exported
 * module function whose types cross without JavaScript,
 * `lucent_<module>_<export>`, declared in lucent_entries.h and defined in
 * lucent_entries.cpp, which also defines the modules' initializer
 * (`lucent_app::initModules`) that the native root and a JavaScript Host
 * both start module state with, and `lucent_launch`, which starts it at
 * app launch when packages list launch modules (decision 0092). Neither
 * file reaches JSI.
 */
import { cpp } from "@lucent-lang/codegen";
import type ts from "typescript";
import { Codes } from "../codes.ts";
import { cppIdent, isVoidish, type LType } from "../types.ts";
import { actorName } from "./actors.ts";
import { identifiers, withoutMacros } from "./macros.ts";
import type { ModuleExports } from "./bindings.ts";
import type { Ctx } from "./context.ts";

export const ENTRIES_HEADER = "lucent_entries.h";
export const ENTRIES_UNIT = "lucent_entries.cpp";

/**
 * How a type crosses an entry: its C type, its C++ type in module code, and
 * the C++ that converts a C value to it (`$` stands for the value) and back
 * (`$` and the Kept, `kept`).
 */
interface Crossing {
  c: string;
  cpp: string;
  in: string;
  out: string;
}

/** What 0091's entries pass as C types of their own. */
const SCALARS: Partial<Record<LType["k"], { c: string; cpp: string }>> = {
  number: { c: "double", cpp: "double" },
  boolean: { c: "bool", cpp: "bool" },
  string: { c: "lucent_string", cpp: "lucent::String" },
  bigint: { c: "int64_t", cpp: "lucent::BigInt" },
  bytes: { c: "lucent_bytes", cpp: "lucent::Bytes" },
};

/** The converters of a lucent_value's kinds (entries.h): `numberIn`, `numberOut`. */
const VALUE_KINDS: Partial<Record<LType["k"], string>> = {
  number: "number",
  boolean: "boolean",
  string: "string",
  bigint: "bigint",
  bytes: "bytes",
  native: "object",
};

/**
 * The converters for a value of type `t` held in a lucent_value (decision
 * 0116): optionals, arrays and records of what crosses, and platform
 * objects. None for another type.
 */
function valueConverters(ctx: Ctx, t: LType): { in: string; out: string } | undefined {
  const e = "lucent::entries::";
  const kind = VALUE_KINDS[t.k];
  if (kind) return { in: `${e}${kind}In`, out: `${e}${kind}Out` };
  const of = (inner: LType) => cpp.printType(ctx.reg.cppType(inner, true));
  switch (t.k) {
    case "opt": {
      const inner = t.rec ? undefined : valueConverters(ctx, t.inner);
      return inner
        ? {
            in: `${e}optionalIn<${of(t.inner)}>(${inner.in}, ${t.absent !== "undefined"})`,
            out: `${e}optionalOut(${inner.out})`,
          }
        : undefined;
    }
    case "array": {
      const element = valueConverters(ctx, t.e);
      return element
        ? { in: `${e}arrayIn<${of(t.e)}>(${element.in})`, out: `${e}arrayOut(${element.out})` }
        : undefined;
    }
    case "dict": {
      const value = valueConverters(ctx, t.val);
      return value
        ? { in: `${e}recordIn<${of(t.val)}>(${value.in})`, out: `${e}recordOut(${value.out})` }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** How `t` crosses an entry: as its own C type (0091), or a lucent_value. */
function crossingOf(ctx: Ctx, t: LType): Crossing | undefined {
  const scalar = SCALARS[t.k];
  if (scalar)
    return {
      ...scalar,
      in: "lucent::entries::in($)",
      out: "lucent::entries::out(kept, $)",
    };
  const value = valueConverters(ctx, t);
  return value
    ? {
        c: "lucent_value",
        cpp: cpp.printType(ctx.reg.cppType(t)),
        in: `${value.in}($)`,
        out: `${value.out}(kept, $)`,
      }
    : undefined;
}

/** A module function's entry: what the two files say of it. */
export interface Entry {
  name: string;
  /** `module.export(parameters)`, for the header's comment. */
  doc: string;
  declaration: string;
  definition: string;
}

/** The C name of a module's export: other characters than letters and digits made `_`. */
export function entryName(module: string, name: string): string {
  return `lucent_${module.replace(/[^A-Za-z0-9]/g, "_")}_${name.replace(/[^A-Za-z0-9]/g, "_")}`;
}

/**
 * The entries of `mods`' exported functions whose parameters and result
 * cross: required parameters only, and no generator. Exports whose names
 * come out the same get none, and LUCENT3016 warns, naming them
 * (decision 0094).
 */
export function entriesOf(ctx: Ctx, mods: ModuleExports[]): Entry[] {
  const out: (Entry & { of: string; node: ts.Node })[] = [];

  for (const m of mods) {
    const actor = ctx.actors.of.get(m.module);
    const actorExpr = actor === undefined ? "lucent::Actor::shared()" : `${actorName(actor)}()`;

    for (const f of [...m.functions, ...(m.native ?? [])]) {
      if (f.generic || f.decl.asteriskToken) continue;
      if (f.params.some((p) => p.optional || p.rest)) continue;

      // Named by position: a parameter's own name could be a macro (NAN)
      // or one of the entry's locals.
      const params = f.params.map((p, i) => ({
        name: `arg${i}`,
        crossing: crossingOf(ctx, p.type),
      }));
      if (params.some((p) => !p.crossing)) continue;

      const ret = f.async
        ? f.type.ret.k === "promise"
          ? f.type.ret.inner
          : f.type.ret
        : f.type.ret;
      const nothing = isVoidish(ret);
      const result = nothing ? undefined : crossingOf(ctx, ret);
      if (!nothing && !result) continue;

      const exportName = f.decl.name!.text;
      const name = entryName(m.module.name, exportName);
      const of = `${m.module.name}.${exportName}`;
      const doc = `${of}(${f.params.map((p) => p.name).join(", ")})`;
      const node = f.decl.name!;

      const cParams = params.map((p) => `${p.crossing!.c} ${p.name}`);
      const args = params.map((p) => p.crossing!.in.replace("$", p.name)).join(", ");
      const fn = `lucent_app::${m.module.ns}::${cppIdent(exportName)}`;

      if (!f.async) {
        const signature = `bool ${name}(${[...cParams, "lucent_error* error", ...(result ? [`${result.c}* result`] : [])].join(", ")})`;
        const body = result
          ? [
              `    auto value = ${fn}(${args});`,
              `    if (result) *result = ${result.out.replace("$", "value")};`,
            ]
          : [`    ${fn}(${args});`];
        out.push({
          name,
          doc,
          of,
          node,
          declaration: `${signature};`,
          definition: [
            `extern "C" ${signature} {`,
            `  return lucent::entries::call(&lucent_app::initModules, ${actorExpr}, error, [&](lucent::entries::Kept& kept) {`,
            ...(result ? [] : ["    (void)kept;"]),
            ...body,
            `  });`,
            `}`,
          ].join("\n"),
        });
        continue;
      }

      const done = result
        ? `void (*done)(void* context, const ${result.c}* result, const lucent_error* error)`
        : `void (*done)(void* context, const lucent_error* error)`;
      const signature = `void ${name}(${[...cParams, done, "void* context"].join(", ")})`;
      const settle = result
        ? [
            `      [done, context](lucent::entries::Kept& kept, const ${result.cpp}* value, const lucent_error* error) {`,
            `        if (!value) return done(context, nullptr, error);`,
            `        ${result.c} out{};`,
            `        try {`,
            `          out = ${result.out.replace("$", "*value")};`,
            `        } catch (...) {`,
            `          lucent_error failed = lucent::entries::errorOf(kept, lucent::entries::caught(std::current_exception()));`,
            `          return done(context, nullptr, &failed);`,
            `        }`,
            `        done(context, &out, nullptr);`,
            `      });`,
          ]
        : [
            `      [done, context](lucent::entries::Kept&, const lucent_error* error) { done(context, error); });`,
          ];
      out.push({
        name,
        doc,
        of,
        node,
        declaration: `${signature};`,
        definition: [
          `extern "C" ${signature} {`,
          `  lucent::entries::callAsync<${result ? result.cpp : "void"}>(`,
          `      &lucent_app::initModules, ${actorExpr},`,
          `      [&] { return ${fn}(${args}); },`,
          ...settle,
          `}`,
        ].join("\n"),
      });
    }
  }

  // Two exports that would share a name: neither gets it, which keeps a name from changing
  // hands when one of them comes or goes.
  const byName = new Map<string, typeof out>();
  for (const e of out) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  for (const [name, same] of byName) {
    if (same.length < 2) continue;
    const [last] = same.slice(-1);
    ctx.warn(
      last!.node,
      Codes.EntryNameClash,
      `${same.map((e) => e.of).join(" and ")} would have the same native entry point, ${name}: neither gets one`,
    );
  }

  return out
    .filter((e) => byName.get(e.name)!.length === 1)
    .map(({ name, doc, declaration, definition }) => ({ name, doc, declaration, definition }));
}

/** lucent_entries.h: a C header Swift, Objective-C, C and C++ can include. */
export function entriesHeader(entries: Entry[]): string {
  return [
    "// Generated by Lucent. Do not edit.",
    "// Native entry points: each runs a module function with or without a",
    "// JavaScript runtime (lucent/entries.h says how).",
    "#pragma once",
    "",
    "#include <lucent/entries.h>",
    "",
    "#ifdef __cplusplus",
    'extern "C" {',
    "#endif",
    "",
    "/// Starts module state at app launch when packages list launch modules",
    "/// (lucent.json's launch), holding it for the process; else nothing.",
    "void lucent_launch(void);",
    "",
    ...entries.flatMap((e) => [`/// ${e.doc}`, e.declaration, ""]),
    "#ifdef __cplusplus",
    "}",
    "#endif",
    "",
  ].join("\n");
}

/**
 * lucent_entries.cpp: the modules' initializer, each module's init()
 * holding its actor in `initializations`' order, lucent_launch, which
 * starts state when `launch` (the launch modules this target has) has any,
 * and the entries.
 */
export function entriesUnit(
  includes: cpp.Decl[],
  initializations: cpp.Stmt[],
  entries: Entry[],
  declared: ReadonlySet<string> = new Set(),
  launch: readonly string[] = [],
): string {
  const head = cpp.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      cpp.include(ENTRIES_HEADER),
      ...includes,
      cpp.include("lucent/entries.h", true),
      ...withoutMacros(
        [cpp.namespace("lucent_app", [cpp.fn("initModules", cpp.voidType, [], initializations)])],
        declared,
      ),
    ],
  });

  // The program's names the entries spell (an export named as a C macro, such as assert),
  // undefined as macros around them, as every generated file does (macros.ts).
  const definitions = entries.flatMap((e) => [e.definition, ""]);
  const spelled = identifiers(definitions.join("\n"));
  const names = [...declared].filter((n) => spelled.has(n)).sort();
  const hide = names.flatMap((n) => [`#pragma push_macro("${n}")`, `#undef ${n}`]);
  const restore = names.toReversed().map((n) => `#pragma pop_macro("${n}")`);

  const launched = launch.length
    ? [
        `// Launch modules: ${launch.join(", ")}.`,
        `extern "C" void lucent_launch(void) { lucent::entries::launch(&lucent_app::initModules); }`,
      ]
    : [
        `// No launch modules: module state starts at its first use.`,
        `extern "C" void lucent_launch(void) {}`,
      ];

  return [
    head.trimEnd(),
    "",
    ...launched,
    "",
    ...(hide.length ? [...hide, ""] : []),
    ...definitions,
    ...(restore.length ? [...restore, ""] : []),
  ].join("\n");
}
