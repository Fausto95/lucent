/**
 * Build identities: what a native program was built from, so JavaScript can
 * tell an app binary built from other Lucent sources than its proxies. A
 * program's hash covers its generated code; a module's API hash covers
 * what JavaScript sees of it (its exports, their signatures and the types
 * that cross with them), so an edit to a body changes the first only.
 * Neither covers machine paths: the same sources build the same identity
 * anywhere.
 */
import type { ComponentDescription } from "../ui/contract.ts";
import { cpp, ts as js } from "@lucent-lang/codegen";
import { createHash } from "node:crypto";
import { isVoidish, type LType, typeKey } from "../types.ts";
import { type ModuleExports, publicMembers, staticMembers } from "./bindings.ts";
import { constructorOf } from "./classes.ts";
import type { Ctx } from "./context.ts";

/**
 * What generated code and proxies expect of the runtime: kRuntimeAbi in
 * runtime cpp/lucent/jsi/host.h, which the generated identity checks as
 * it builds. A change to the runtime that breaks either takes a new one.
 */
export const RUNTIME_ABI = 2;

/** The generated C++ unit that carries a program's identity. */
export const IDENTITY_UNIT = "lucent_identity.cpp";

/**
 * What a compile built, by target (`ios`, `android`, `host`, or `all` for a
 * program every target shares): each program's hash and each module's API.
 */
export interface BuildIdentity {
  runtimeAbi: number;
  programs: Record<string, string>;
  apis: Record<string, Record<string, string>>;
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** A trace site's file and line (`LUCENT_TRACE_SITE_AT(name, file, line)`), after its name. */
const TRACE_SITE_POSITION = /(LUCENT_TRACE_SITE_AT\("(?:[^"\\]|\\.)*"), "(?:[^"\\]|\\.)*", \d+\)/g;

/**
 * The hash of a program's generated files. Source positions are left out:
 * `#line` directives and trace sites' files and lines hold the machine's
 * paths, and code moved to other lines is the same program.
 */
export function programHash(files: Iterable<[string, string]>): string {
  const h = createHash("sha256");

  for (const [name, content] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const code = content
      .split("\n")
      .filter((line) => !line.startsWith("#line "))
      .join("\n")
      .replace(TRACE_SITE_POSITION, "$1)");

    h.update(`${name}\n${code.length}\n${code}`);
  }

  return h.digest("hex").slice(0, 16);
}

/** An interface's id names its file (`/path/to/shapes.lucent.ts#Shape`): the file's name is enough. */
const portable = (key: string) => key.replace(/I:[^#<>,|()[\]?;]*[/\\]([^/\\#]+)#/g, "I:$1#");

/**
 * What JavaScript sees of a module, as text: its exports with their
 * signatures, then each type that crosses with them (struct fields, class
 * members, an interface's implementations).
 */
export function apiSurface(
  ctx: Ctx,
  m: ModuleExports,
  components: readonly ComponentDescription[] = [],
): string {
  const reg = ctx.reg;
  const types = new Map<string, string>();

  const key = (t: LType): string => {
    describe(t);

    return portable(typeKey(t));
  };

  const classOf = (id: string) => ({ k: "class" as const, id, args: [] as LType[] });

  function describe(t: LType): void {
    switch (t.k) {
      case "struct": {
        if (types.has(typeKey(t))) return;
        types.set(typeKey(t), "");

        const fields = reg
          .struct(t.id)
          .fields.map(
            (f) =>
              `${f.readonly ? "readonly " : ""}${f.name}${f.optional ? "?" : ""}: ${key(f.type)}`,
          );

        types.set(typeKey(t), `struct ${portable(typeKey(t))} { ${fields.join("; ")} }`);
        return;
      }
      case "class": {
        if (types.has(typeKey(t))) return;
        types.set(typeKey(t), "");

        const info = reg.cls(t.id);
        const members = publicMembers(ctx, info).map(
          (p) =>
            `${p.kind} ${p.name}(${p.types.map(key).join(", ")})${p.writable ? " writable" : ""}${p.async ? " async" : ""}`,
        );
        const base = info.base
          ? ` extends ${key({ k: "class", id: info.base.id, args: info.base.args })}`
          : "";

        types.set(typeKey(t), `class ${portable(typeKey(t))}${base} { ${members.join("; ")} }`);

        // A value of this class may hold any subclass: their prototypes cross too.
        for (const d of reg.descendants(t.id)) if (!d.typeParams.length) describe(classOf(d.id));
        return;
      }
      case "iface": {
        if (types.has(typeKey(t))) return;
        types.set(typeKey(t), "");

        const impls = reg.implementations(t).map((c) => key(classOf(c.id)));

        types.set(typeKey(t), `interface ${portable(typeKey(t))} = ${impls.sort().join(" | ")}`);
        return;
      }
      case "union":
        return t.ms.forEach(describe);
      case "tuple":
        return t.es.forEach(describe);
      case "array":
      case "set":
      case "iter":
        return describe(t.e);
      case "dict":
        return describe(t.val);
      case "map":
        describe(t.key);
        return describe(t.val);
      case "opt":
      case "promise":
        return describe(t.inner);
      case "fn":
        t.params.forEach(describe);
        return describe(t.ret);
      default:
        return;
    }
  }

  const signature = (params: string[], ret: LType, async = false) =>
    `(${params.join(", ")}) => ${async ? "async " : ""}${isVoidish(ret) ? "void" : key(ret)}`;

  const lines: string[] = [];

  for (const f of m.functions) {
    const params = f.params.map(
      (p) => `${p.rest ? "..." : ""}${key(p.cppType)}${p.optional ? "?" : ""}`,
    );

    lines.push(`function ${f.decl.name!.text}${signature(params, f.type.ret, f.async)}`);
  }

  for (const c of m.classes) {
    const self = classOf(c.id);
    const params = constructorOf(ctx, self).map((p) => `${key(p.type)}${p.optional ? "?" : ""}`);
    const statics = c.typeParams.length
      ? []
      : staticMembers(ctx, c).map(
          (p) =>
            `static ${p.kind} ${p.name}(${p.types.map(key).join(", ")})${p.writable ? " writable" : ""}${p.async ? " async" : ""}`,
        );

    lines.push(
      `class ${c.decl.name!.text} = ${key(self)}${c.abstract ? " abstract" : ""} new(${params.join(", ")}) { ${statics.join("; ")} }`,
    );
  }

  for (const c of m.consts) lines.push(`const ${c.decl.name.getText()}: ${key(c.type)}`);

  for (const e of m.enums)
    lines.push(
      `enum ${e.name} { ${e.members.map((x) => `${x.name} = ${JSON.stringify(x.value)}`).join("; ")} }`,
    );

  // The components it exports (React components): their contracts.
  for (const c of components.toSorted((a, b) => (a.export < b.export ? -1 : 1)))
    lines.push(
      `component ${c.export} = ${JSON.stringify({
        registration: c.registration,
        props: c.props,
        events: c.events,
        commands: c.commands,
      })}`,
    );

  const described = [...types.values()].sort();

  return [...lines, ...described].join("\n");
}

/** The hash of what JavaScript sees of a module: its exports, and the components it exports. */
export function apiHash(
  ctx: Ctx,
  m: ModuleExports,
  components: readonly ComponentDescription[] = [],
): string {
  return hash(apiSurface(ctx, m, components));
}

/**
 * The C++ unit that tells the runtime what its program was built as
 * (lucent::js::buildIdentity), after checking that runtime's ABI.
 */
export function identityUnit(
  target: string,
  program: string,
  apis: Record<string, string>,
): string {
  const entries = Object.entries(apis).map(([name, api]) =>
    cpp.initList([cpp.str(name), cpp.str(api)]),
  );
  const modules = cpp.id("kModuleIdentities");

  return cpp.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      cpp.include("lucent/jsi/host.h", true),
      {
        k: "staticAssert",
        test: cpp.binary(cpp.id("lucent::js::kRuntimeAbi"), "==", cpp.num(RUNTIME_ABI)),
        message: `generated for Lucent runtime ABI ${RUNTIME_ABI}: build it with the runtime lucent build copied next to it`,
      },
      cpp.namespace("", [
        {
          k: "var",
          stmt: {
            ...cpp.varDecl(
              cpp.constType(cpp.type("lucent::js::ModuleIdentity")),
              "kModuleIdentities",
              cpp.initList(entries.length ? entries : [cpp.initList([cpp.str(""), cpp.str("")])]),
            ),
            array: true,
          },
        },
      ]),
      cpp.namespace("lucent::js", [
        cpp.fn(
          "buildIdentity",
          cpp.reference(cpp.constType(cpp.type("BuildIdentity"))),
          [],
          [
            {
              ...cpp.varDecl(
                cpp.constType(cpp.type("BuildIdentity")),
                "identity",
                cpp.initList([cpp.str(target), cpp.str(program), modules, cpp.num(entries.length)]),
                { static: true },
              ),
            },
            cpp.ret(cpp.id("identity")),
          ],
        ),
      ]),
    ],
  });
}

/** The build identity as the module the proxies require (js/_lucent/identity.js). */
export function identityScript(identity: BuildIdentity): string {
  const literal = (v: number | string | Record<string, unknown>): js.Expr =>
    typeof v === "number"
      ? js.num(v)
      : typeof v === "string"
        ? js.str(v)
        : js.objectLit(
            Object.entries(v).map(([key, value]) => ({
              key,
              value: literal(value as Parameters<typeof literal>[0]),
              quoted: true,
            })),
          );
  const exports = js.member(js.name("module"), "exports");

  return js.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      js.stmt(js.exprStmt(js.str("use strict"))),
      js.stmt(js.exprStmt(js.assign(exports, literal({ ...identity })))),
    ],
  });
}
