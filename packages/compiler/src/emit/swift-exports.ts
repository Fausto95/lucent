/**
 * The Swift API native code calls a module's exports through (decision
 * 0116): LucentExports.swift in the native package's pod, whose Swift
 * module (`LucentNative`) holds it, with a `public enum` per module, named
 * from its path in upper camel case, holding its functions as static
 * methods and its classes as nested wrapper classes. The API calls the C
 * entries (entries.ts), which the pod's module gives its Swift as C:
 * lucent_entries.h and the types it passes are its public headers.
 */
import { swift } from "@lucent-lang/codegen";
import { sdkTypeInfo } from "../sdk/schema.ts";
import type { ClassInfo, LType } from "../types.ts";
import { type Entry, type EntryApi, entryName } from "./entries.ts";

export const SWIFT_EXPORTS = "LucentExports.swift";

/** The Swift API's own names, which no module's or class's may take. */
const RESERVED_TYPES = new Set([
  "LucentNative",
  "LucentError",
  "LucentInstance",
  "LucentArena",
  "LucentOut",
  "LucentAwait",
  "Swift",
  "Foundation",
  "CheckedContinuation",
]);

/** Names a member or parameter can't have, even escaped; and the API's locals and own property. */
const UNUSABLE = new Set([
  "init",
  "deinit",
  "subscript",
  "self",
  "Self",
  "super",
  "Type",
  "Protocol",
  "_",
  "lucentObject",
  "lucentArena",
  "lucentError",
  "lucentResult",
  "lucentContinuation",
]);

/** Swift's keywords, which a name escapes as `` `in` ``. */
const KEYWORDS = new Set(
  (
    "associatedtype class deinit enum extension fileprivate func import init inout internal let " +
    "open operator private precedencegroup protocol public rethrows static struct subscript " +
    "typealias var break case catch continue default defer do else fallthrough for guard if in " +
    "repeat return throw switch where while Any as await false is nil super throws true try"
  ).split(" "),
);

/** Whether a TypeScript name has a Swift API: an identifier Swift spells too. */
const swiftName = (n: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !UNUSABLE.has(n);

/** A name as Swift spells it: a keyword in backticks. */
const ident = (n: string) => (KEYWORDS.has(n) ? `\`${n}\`` : n);

/** A module's Swift name: its path's words in upper camel case (`lucent-sync/workers` is `LucentSyncWorkers`). */
export function swiftModuleName(module: string): string | undefined {
  const name = module
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Za-z]/.test(name) ? name : undefined;
}

const t = swift.type;
const n = swift.name;

/** The standard library's types, by their module: a class named `Double` in a module's enum doesn't hide them. */
const SCALAR_TYPES: Partial<Record<LType["k"], string>> = {
  number: "Swift.Double",
  boolean: "Swift.Bool",
  bigint: "Swift.Int64",
  string: "Swift.String",
  bytes: "Foundation.Data",
};

/** The names the value converters (LucentArena's, LucentOut's) have for a kind. */
const VALUE_IN: Partial<Record<LType["k"], string>> = {
  number: "number",
  boolean: "boolean",
  bigint: "bigint",
  string: "stringValue",
  bytes: "bytesValue",
};

interface Context {
  /** The wrappers: an exported class's Swift name, by its id. */
  wrappers: ReadonlyMap<string, { info: ClassInfo; swiftName: string; init: string }>;
  /** The SDK modules a platform object's type names, for the file's imports. */
  imports: Set<string>;
}

/** The Swift type of a platform object: a Swift class's own name, an Objective-C class's Swift name. */
function platformType(lt: LType & { k: "native" }, cx: Context): string {
  const info = sdkTypeInfo("ios", lt.module, lt.name);
  cx.imports.add(lt.module);
  return info?.swift ? info.native : `${lt.module}.${lt.name.replace(/_/g, ".")}`;
}

/** The Swift type of a parameter or result. */
function swiftType(lt: LType, cx: Context): swift.Type {
  const scalar = SCALAR_TYPES[lt.k];
  if (scalar) return t(scalar);
  switch (lt.k) {
    case "class": {
      // A class with no wrapper of its own: its instances are LucentInstances.
      const w = cx.wrappers.get(lt.id);
      return t(w ? w.swiftName : "LucentNative.LucentInstance");
    }
    case "opt":
      return swift.optional(swiftType(lt.inner, cx));
    case "array":
      return swift.array(swiftType(lt.e, cx));
    case "dict":
      return swift.dictionary(t("Swift.String"), swiftType(lt.val, cx));
    case "native":
      return t(platformType(lt, cx));
    default:
      throw new Error(`no Swift type for ${lt.k}`);
  }
}

/** A wrapper's initializer from a lucent_object the caller owns, as a closure: `{ C(lucent_m_C: $0) }`. */
function makeWrapper(lt: LType & { k: "class" }, cx: Context): swift.Expr {
  const w = cx.wrappers.get(lt.id);
  return swift.closure(
    [],
    [
      swift.exprStmt(
        swift.call(n(w ? w.swiftName : "LucentNative.LucentInstance"), [
          { label: w ? w.init : "lucentObject", value: n("$0") },
        ]),
      ),
    ],
  );
}

/** `{ <in>($0) }`: what makes a lucent_value of `lt`, for an optional's, an array's or a record's. */
function valueIn(lt: LType, cx: Context): swift.Expr {
  const arena = (name: string, ...args: swift.Expr[]) =>
    swift.call(
      swift.member(n("lucentArena"), name),
      args.map((value) => ({ value })),
    );
  const of = (e: swift.Expr) => swift.closure([], [swift.exprStmt(e)]);
  const named = VALUE_IN[lt.k];
  if (named) return of(arena(named, n("$0")));
  switch (lt.k) {
    case "class":
      return of(arena("instance", n("$0")));
    case "native":
      platformType(lt, cx);
      return of(arena("object", n("$0")));
    case "opt":
      return of(arena("optional", n("$0"), valueIn(lt.inner, cx)));
    case "array":
      return of(arena("array", n("$0"), valueIn(lt.e, cx)));
    case "dict":
      return of(arena("record", n("$0"), valueIn(lt.val, cx)));
    default:
      throw new Error(`no lucent_value of ${lt.k}`);
  }
}

/** `{ <out>($0) }`: the Swift value of a lucent_value of `lt`. */
function valueOut(lt: LType, cx: Context): swift.Expr {
  const out = (name: string, ...args: swift.Expr[]) =>
    swift.call(
      swift.member(n("LucentOut"), name),
      args.map((value) => ({ value })),
    );
  const of = (e: swift.Expr) => swift.closure([], [swift.exprStmt(e)]);
  switch (lt.k) {
    case "number":
    case "boolean":
    case "bigint":
    case "string":
    case "bytes":
      return of(out(lt.k, n("$0")));
    case "class":
      return of(out("instance", n("$0"), makeWrapper(lt, cx)));
    case "native":
      return of(swift.cast(out("object", n("$0")), "as", t(platformType(lt, cx))));
    case "opt":
      return of(out("optional", n("$0"), valueOut(lt.inner, cx)));
    case "array":
      return of(out("array", n("$0"), valueOut(lt.e, cx)));
    case "dict":
      return of(out("record", n("$0"), valueOut(lt.val, cx)));
    default:
      throw new Error(`no Swift value of ${lt.k}`);
  }
}

/** A converter closure's expression applied to `v`: its `$0` (not a nested closure's) as `v`. */
function applied(conv: swift.Expr, v: swift.Expr): swift.Expr {
  const body = (conv as swift.Expr & { k: "closure" }).body[0] as swift.Stmt & { k: "expr" };
  const walk = (e: swift.Expr): swift.Expr => {
    switch (e.k) {
      case "name":
        return e.name === "$0" ? v : e;
      case "call":
        return {
          ...e,
          callee: walk(e.callee),
          args: e.args.map((a) => ({ ...a, value: walk(a.value) })),
        };
      case "member":
        return { ...e, object: walk(e.object) };
      case "cast":
        return { ...e, value: walk(e.value) };
      default:
        return e;
    }
  };
  return walk(body.expr);
}

/** The C argument of Swift value `v`, of type `lt` crossing as C type `c`. */
function argument(v: swift.Expr, lt: LType, c: string, cx: Context): swift.Expr {
  switch (c) {
    case "double":
    case "bool":
    case "int64_t":
      return v;
    case "lucent_string":
      return swift.call(swift.member(n("lucentArena"), "string"), [{ value: v }]);
    case "lucent_bytes":
      return swift.call(swift.member(n("lucentArena"), "bytes"), [{ value: v }]);
    case "lucent_object":
      return swift.member(v, "lucentObject");
    default:
      // A lucent_value: the converter applied to it.
      return applied(valueIn(lt, cx), v);
  }
}

/** Whether a C type an entry takes points into the arena. */
const usesArena = (c: string) => !["double", "bool", "int64_t", "lucent_object"].includes(c);

/** The Swift value of C result `r` (`lucentResult`, or a completion's `result!.pointee`). */
function result(r: swift.Expr, lt: LType, c: string, cx: Context): swift.Expr {
  switch (c) {
    case "double":
    case "bool":
    case "int64_t":
      return r;
    case "lucent_string":
      return swift.call(swift.member(n("LucentOut"), "string"), [{ value: r }]);
    case "lucent_bytes":
      return swift.call(swift.member(n("LucentOut"), "bytes"), [{ value: r }]);
    case "lucent_object":
      return swift.call(swift.member(n("LucentOut"), "instance"), [
        { value: r },
        { value: makeWrapper(lt as LType & { k: "class" }, cx) },
      ]);
    default:
      return applied(valueOut(lt, cx), r);
  }
}

/** A synchronous entry's result variable, zero until it writes it. */
function resultVar(c: string): swift.Stmt {
  const zero: Record<string, [string, swift.Expr]> = {
    double: ["Swift.Double", swift.num(0)],
    bool: ["Swift.Bool", swift.bool(false)],
    int64_t: ["Swift.Int64", swift.num(0)],
    lucent_object: ["Swift.OpaquePointer?", swift.nil],
  };
  const z = zero[c];
  return z
    ? { k: "var", name: "lucentResult", type: t(z[0]), init: z[1] }
    : { k: "var", name: "lucentResult", init: swift.call(n(c), []) };
}

const throwError: swift.Stmt = swift.throwStmt(
  swift.call(n("LucentError"), [{ value: n("lucentError") }]),
);

/**
 * The statements calling `entry` with `args` (the instance first, for a
 * member): a synchronous entry's, which give its result (`ret`, the API's
 * way to give it: return it, or wrap it in `self.init`), or an async
 * entry's, resuming its continuation.
 */
function callEntry(
  entry: Entry,
  self: swift.Expr | undefined,
  cx: Context,
  give: (value: swift.Expr) => swift.Stmt = (v) => swift.ret(v),
): swift.Stmt[] {
  const api = entry.api;
  const arena = api.params.some((p) => usesArena(p.c));
  const args = [
    ...(self ? [self] : []),
    ...api.params.map((p) => argument(n(ident(p.name)), p.type, p.c, cx)),
  ];
  const head: swift.Stmt[] = arena
    ? [
        swift.letStmt("lucentArena", swift.call(n("LucentArena"), [])),
        {
          k: "defer",
          body: [swift.exprStmt(swift.call(swift.member(n("lucentArena"), "free"), []))],
        },
      ]
    : [];
  const retC = api.kind === "new" ? "lucent_object" : api.ret?.c;
  const retType: LType | undefined =
    api.kind === "new" ? { k: "class", id: api.cls!.id, args: [] } : api.ret?.type;

  if (!api.async) {
    const call = swift.call(
      n(entry.name),
      [
        ...args,
        swift.addressOf(n("lucentError")),
        ...(retC ? [swift.addressOf(n("lucentResult"))] : []),
      ].map((value) => ({ value })),
    );
    return [
      ...head,
      { k: "var", name: "lucentError", init: swift.call(n("lucent_error"), []) },
      ...(retC ? [resultVar(retC)] : []),
      { k: "guard", test: call, orElse: [throwError] },
      ...(retC ? [give(result(n("lucentResult"), retType!, retC, cx))] : []),
    ];
  }

  // Async: the completion settles the continuation it is given as its context.
  const value = swift.closure(
    [],
    [
      swift.exprStmt(
        retC
          ? result(swift.member(swift.forceUnwrap(n("result")), "pointee"), retType!, retC, cx)
          : swift.tupleLiteral([]),
      ),
    ],
  );
  const awaited = retC ? swift.printType(swiftType(retType!, cx)) : "Swift.Void";
  const done = swift.closure(retC ? ["context, result, error"] : ["context, error"], [
    swift.exprStmt(
      swift.call(
        swift.member(n(`LucentAwait<${awaited}>`), "settle"),
        [{ value: n("context") }, { value: n("error") }],
        value,
      ),
    ),
  ]);
  const start = swift.call(
    n(entry.name),
    [
      ...args,
      done,
      swift.member(
        swift.call(n(`LucentAwait<${awaited}>`), [{ value: n("lucentContinuation") }]),
        "context",
      ),
    ].map((v) => ({ value: v })),
  );
  return [
    swift.ret(
      swift.tryExpr(
        swift.awaitExpr(
          swift.call(
            n("withCheckedThrowingContinuation"),
            [],
            swift.closure(["lucentContinuation"], [...head, swift.exprStmt(start)]),
          ),
        ),
      ),
    ),
  ];
}

const params = (api: EntryApi, cx: Context): swift.Param[] =>
  api.params.map((p) => ({ name: ident(p.name), type: swiftType(p.type, cx) }));

const effects = (api: EntryApi) => (api.async ? ["async", "throws"] : ["throws"]);

/** A function calling `entry`: a module's static one, or a class's method. */
function method(
  entry: Entry,
  modifiers: string[],
  self: swift.Expr | undefined,
  cx: Context,
): swift.Member {
  const api = entry.api;
  return {
    k: "func",
    modifiers,
    name: ident(api.member),
    params: params(api, cx),
    effects: effects(api),
    ...(api.ret ? { ret: swiftType(api.ret.type, cx) } : {}),
    body: callEntry(entry, self, cx),
  };
}

/** `setValue`: a writable property's setter, as a method (a Swift setter can't throw). */
const setterName = (member: string) => `set${member[0]!.toUpperCase()}${member.slice(1)}`;

/** A member's Swift signature, to tell an override from a member of its own. */
function signature(e: Entry, cx: Context): string {
  const api = e.api;
  return [
    api.kind,
    api.member,
    ...api.params.map((p) => swift.printType(swiftType(p.type, cx))),
    api.ret ? swift.printType(swiftType(api.ret.type, cx)) : "",
    String(api.async),
  ].join("|");
}

/** Statics declared by an ancestor's wrapper, and members it declares, belong to it alone. */
function classDecl(
  info: ClassInfo,
  entries: readonly Entry[],
  cx: Context,
  subclassed: ReadonlySet<string>,
): swift.Decl & { k: "class" } {
  const w = cx.wrappers.get(info.id)!;
  const base = info.base ? cx.wrappers.get(info.base.id) : undefined;
  const own = entries.filter((e) => e.api.cls === info);
  const declaredHere = (e: Entry) =>
    e.api.declaredBy === info || !(e.api.declaredBy && cx.wrappers.has(e.api.declaredBy.id));
  // What an ancestor's wrapper declares: overridden when the signature is the same, else left.
  const inBase = (e: Entry): "same" | "other" | undefined => {
    let found: "same" | "other" | undefined;
    for (let b = base; b && !found; b = b.info.base ? cx.wrappers.get(b.info.base.id) : undefined) {
      const theirs = entries.find(
        (x) =>
          x.api.cls === b!.info &&
          !x.api.isStatic &&
          x.api.member === e.api.member &&
          x.api.kind === e.api.kind,
      );
      if (theirs) found = signature(theirs, cx) === signature(e, cx) ? "same" : "other";
    }
    return found;
  };
  const self = n("lucentObject");
  const members: swift.Member[] = [
    {
      k: "init",
      modifiers: [],
      params: [{ external: w.init, name: "lucentObject", type: t("Swift.OpaquePointer") }],
      body: [
        swift.exprStmt(
          swift.call(swift.member(n("super"), "init"), [
            { label: base ? base.init : "lucentObject", value: n("lucentObject") },
          ]),
        ),
      ],
    },
  ];

  const ctor = own.find((e) => e.api.kind === "new");
  if (ctor)
    members.push({
      k: "init",
      modifiers: ["public", "convenience"],
      params: params(ctor.api, cx),
      effects: ["throws"],
      body: callEntry(ctor, undefined, cx, () =>
        swift.exprStmt(
          swift.call(swift.member(n("self"), "init"), [
            { label: w.init, value: swift.forceUnwrap(n("lucentResult")) },
          ]),
        ),
      ),
    });

  const names = new Set(own.map((e) => e.api.member));
  for (const e of own) {
    if (e.api.kind === "new" || !declaredHere(e)) continue;
    const overrides = e.api.isStatic ? undefined : inBase(e);
    if (overrides === "other") continue;
    const modifiers = [
      ...(overrides ? ["override"] : []),
      "public",
      ...(e.api.isStatic ? ["static"] : []),
    ];
    const on = e.api.isStatic ? undefined : self;
    if (e.api.kind === "method") members.push(method(e, modifiers, on, cx));
    else if (e.api.kind === "get")
      members.push({
        k: "property",
        modifiers,
        name: ident(e.api.member),
        type: swiftType(e.api.ret!.type, cx),
        get: callEntry(e, on, cx),
        effects: ["throws"],
      });
    else if (e.api.kind === "set" && !names.has(setterName(e.api.member)))
      members.push({
        k: "func",
        modifiers,
        name: setterName(e.api.member),
        params: [{ external: "_", name: "value", type: swiftType(e.api.params[0]!.type, cx) }],
        effects: ["throws"],
        body: callEntry(
          { ...e, api: { ...e.api, params: [{ ...e.api.params[0]!, name: "value" }] } },
          on,
          cx,
        ),
      });
  }

  return {
    k: "class",
    name: w.swiftName.slice(w.swiftName.lastIndexOf(".") + 1),
    modifiers: ["public", ...(subclassed.has(info.id) ? [] : ["final"])],
    superclass: t(base ? base.swiftName : "LucentNative.LucentInstance"),
    protocols: [t("@unchecked Swift.Sendable")],
    members,
  };
}

/**
 * The Swift API of `entries` (an iOS target's, or a shared program's), and
 * what it adds to the entries: `lucent_classof`, which names the wrapper
 * an instance an entry gives is of. Modules whose Swift names come out
 * the same, or the API's own, get none: `clashes` names them.
 */
export function swiftExports(all: readonly Entry[]): {
  file?: string;
  header: string;
  cpp: string;
  clashes: { modules: string[]; name: string }[];
} {
  const usable = all.filter(
    (e) =>
      swiftName(e.api.member) &&
      e.api.params.every((p) => swiftName(p.name)) &&
      (!e.api.cls ||
        (swiftName(e.api.cls.decl.name!.text) && !RESERVED_TYPES.has(e.api.cls.decl.name!.text))),
  );

  // Each module's Swift name; modules sharing one, or taking the API's, get none.
  const byName = new Map<string, string[]>();
  for (const module of new Set(usable.map((e) => e.api.module))) {
    const name = swiftModuleName(module);
    if (name) byName.set(name, [...(byName.get(name) ?? []), module]);
  }
  const clashes = [...byName]
    .filter(([name, modules]) => modules.length > 1 || RESERVED_TYPES.has(name))
    .map(([name, modules]) => ({ name, modules }));
  const enumOf = new Map(
    [...byName]
      .filter(([name, modules]) => modules.length === 1 && !RESERVED_TYPES.has(name))
      .map(([name, [module]]) => [module!, name]),
  );
  const entries = usable.filter((e) => enumOf.has(e.api.module));
  if (!entries.length) return { header: "", cpp: "", clashes };

  const wrappers = new Map<string, { info: ClassInfo; swiftName: string; init: string }>();
  for (const e of entries)
    if (e.api.cls && !wrappers.has(e.api.cls.id)) {
      const info = e.api.cls;
      wrappers.set(info.id, {
        info,
        swiftName: `LucentNative.${enumOf.get(e.api.module)}.${info.decl.name!.text}`,
        init: entryName(info.module, info.decl.name!.text),
      });
    }
  const cx: Context = { wrappers, imports: new Set() };
  const subclassed = new Set(
    [...wrappers.values()].flatMap((w) =>
      w.info.base && wrappers.has(w.info.base.id) ? [w.info.base.id] : [],
    ),
  );

  const enums: swift.Decl[] = [];
  for (const [module, name] of enumOf) {
    const mine = entries.filter((e) => e.api.module === module);
    if (!mine.length) continue;
    const members: swift.Member[] = mine
      .filter((e) => e.api.kind === "function")
      .map((e) => method(e, ["public", "static"], undefined, cx));
    for (const w of wrappers.values())
      if (w.info.module === module)
        members.push({ k: "type", decl: classDecl(w.info, entries, cx, subclassed) });
    enums.push({ k: "enum", name, modifiers: ["public"], members });
  }

  // The nearest class with a wrapper an instance is of: subclasses before their bases.
  const depth = (info: ClassInfo): number =>
    info.base && wrappers.has(info.base.id) ? 1 + depth(wrappers.get(info.base.id)!.info) : 0;
  const ordered = [...wrappers.values()].sort((a, b) => depth(b.info) - depth(a.info));
  const key = (info: ClassInfo) => `${info.module}.${info.decl.name!.text}`;

  const decls: swift.Decl[] = [
    { k: "import", module: "Foundation" },
    ...[...cx.imports].sort().map((module): swift.Decl => ({ k: "import", module })),
    { k: "verbatim", text: SUPPORT },
    ...(wrappers.size
      ? [
          {
            k: "func",
            modifiers: [],
            name: "lucentWrapper",
            params: [{ external: "_", name: "object", type: t("Swift.OpaquePointer") }],
            ret: swift.optional(t("LucentInstance")),
            body: [
              {
                k: "switch",
                on: swift.call(n("Swift.String"), [
                  {
                    label: "cString",
                    value: swift.call(n("lucent_classof"), [{ value: n("object") }]),
                  },
                ]),
                cases: [
                  ...ordered.map((w) => ({
                    patterns: [JSON.stringify(key(w.info))],
                    body: [
                      swift.ret(
                        swift.call(n(w.swiftName), [{ label: w.init, value: n("object") }]),
                      ),
                    ],
                  })),
                  { patterns: ["default"], body: [swift.ret(swift.nil)] },
                ],
              },
            ],
          } satisfies swift.Decl,
        ]
      : [
          {
            k: "func",
            modifiers: [],
            name: "lucentWrapper",
            params: [{ external: "_", name: "object", type: t("Swift.OpaquePointer") }],
            ret: swift.optional(t("LucentInstance")),
            body: [swift.ret(swift.nil)],
          } satisfies swift.Decl,
        ]),
    ...enums,
  ];

  const file = swift.printUnit({
    banner:
      "Generated by Lucent: the Swift API of the program's exports (decision 0116), which calls their C entries. Do not edit.",
    decls,
  });

  const classof = "lucent_classof";
  const header = wrappers.size
    ? [
        "/// The exported class with a Swift API an instance is of, its own or its",
        "/// nearest ancestor's (`module.Class`; empty for none): the Swift API's wrappers.",
        `const char* ${classof}(lucent_object object);`,
        "",
      ].join("\n")
    : "";
  const cpp = wrappers.size
    ? [
        "// The Swift API's (decision 0116): the wrapper an instance an entry gives is of.",
        `extern "C" const char* ${classof}(lucent_object object) {`,
        "  lucent::Object* o = object ? object->instance.get() : nullptr;",
        ...ordered.map(
          (w) =>
            `  if (dynamic_cast<lucent_app::${w.info.cppName}*>(o)) return ${JSON.stringify(key(w.info))};`,
        ),
        '  return "";',
        "}",
        "",
      ].join("\n")
    : "";
  return { file, header, cpp, clashes };
}

/** What every Swift API holds: its error, its instances' base, and the conversions of what crosses. */
const SUPPORT = `/// What Lucent code threw: the Error's name ("RangeError"), its message, and
/// its code (empty without one).
public struct LucentError: Swift.Error, Swift.CustomStringConvertible {
  public let name: Swift.String
  public let message: Swift.String
  public let code: Swift.String

  init(_ error: lucent_error) {
    name = LucentOut.string(error.name)
    message = LucentOut.string(error.message)
    code = LucentOut.string(error.code)
  }

  public var description: Swift.String { "\\(name): \\(message)" }
}

/// An instance of an exported class that native code holds, with its
/// module's state: the wrapper releases it when it goes.
public class LucentInstance: @unchecked Swift.Sendable {
  /// The lucent_object the wrapper owns, for C entries (lucent_entries.h).
  public let lucentObject: Swift.OpaquePointer

  init(lucentObject: Swift.OpaquePointer) { self.lucentObject = lucentObject }

  deinit { lucent_release(lucentObject) }
}

/// What a call's arguments point into, until it returns.
final class LucentArena {
  private var blocks: [Swift.UnsafeMutableRawPointer] = []

  func free() {
    for block in blocks { block.deallocate() }
    blocks = []
  }

  private func copy<T>(_ items: [T]) -> Swift.UnsafePointer<T>? {
    if items.isEmpty { return nil }
    let p = Swift.UnsafeMutablePointer<T>.allocate(capacity: items.count)
    p.initialize(from: items, count: items.count)
    blocks.append(Swift.UnsafeMutableRawPointer(p))
    return Swift.UnsafePointer(p)
  }

  func string(_ s: Swift.String) -> lucent_string {
    let utf8 = Swift.Array(s.utf8)
    let data = copy(utf8).map { Swift.UnsafeRawPointer($0).assumingMemoryBound(to: Swift.CChar.self) }
    return lucent_string(data: data, length: utf8.count)
  }

  func bytes(_ d: Foundation.Data) -> lucent_bytes { lucent_bytes(data: copy([Swift.UInt8](d)), length: d.count) }

  func number(_ v: Swift.Double) -> lucent_value { lucent_value(kind: LUCENT_NUMBER, as: .init(number: v)) }
  func boolean(_ v: Swift.Bool) -> lucent_value { lucent_value(kind: LUCENT_BOOLEAN, as: .init(boolean: v)) }
  func bigint(_ v: Swift.Int64) -> lucent_value { lucent_value(kind: LUCENT_BIGINT, as: .init(bigint: v)) }
  func stringValue(_ v: Swift.String) -> lucent_value { lucent_value(kind: LUCENT_STRING, as: .init(string: string(v))) }
  func bytesValue(_ v: Foundation.Data) -> lucent_value { lucent_value(kind: LUCENT_BYTES, as: .init(bytes: bytes(v))) }

  func object(_ v: Any) -> lucent_value {
    lucent_value(kind: LUCENT_PLATFORM_OBJECT, as: .init(object: Swift.Unmanaged.passUnretained(v as Swift.AnyObject).toOpaque()))
  }

  func instance(_ v: LucentInstance) -> lucent_value { lucent_value(kind: LUCENT_INSTANCE, as: .init(instance: v.lucentObject)) }

  func optional<T>(_ v: T?, _ some: (T) -> lucent_value) -> lucent_value {
    guard let v else { return lucent_value() }
    return some(v)
  }

  func array<T>(_ v: [T], _ item: (T) -> lucent_value) -> lucent_value {
    lucent_value(kind: LUCENT_ARRAY, as: .init(array: lucent_array(items: copy(v.map(item)), length: v.count)))
  }

  func record<T>(_ v: [Swift.String: T], _ value: (T) -> lucent_value) -> lucent_value {
    let entries = Swift.Array(v)
    let record = lucent_record(
      keys: copy(entries.map { string($0.key) }), values: copy(entries.map { value($0.value) }), length: entries.count)
    return lucent_value(kind: LUCENT_RECORD, as: .init(record: record))
  }
}

/// What an entry gives, as Swift values: copied before Lucent reuses it.
enum LucentOut {
  static func string(_ s: lucent_string) -> Swift.String {
    guard let data = s.data, s.length > 0 else { return "" }
    return Swift.String(decoding: Swift.UnsafeRawBufferPointer(start: data, count: s.length), as: Swift.UTF8.self)
  }

  static func bytes(_ b: lucent_bytes) -> Foundation.Data {
    guard let data = b.data, b.length > 0 else { return Foundation.Data() }
    return Foundation.Data(bytes: data, count: b.length)
  }

  static func number(_ v: lucent_value) -> Swift.Double { v.as.number }
  static func boolean(_ v: lucent_value) -> Swift.Bool { v.as.boolean }
  static func bigint(_ v: lucent_value) -> Swift.Int64 { v.as.bigint }
  static func string(_ v: lucent_value) -> Swift.String { string(v.as.string) }
  static func bytes(_ v: lucent_value) -> Foundation.Data { bytes(v.as.bytes) }

  static func object<T>(_ v: lucent_value) -> T {
    Swift.Unmanaged<Swift.AnyObject>.fromOpaque(v.as.object).takeUnretainedValue() as! T
  }

  /// The wrapper of the nearest class with one an instance is of: \`make\`'s,
  /// the declared class's, when it is that class's.
  static func instance<T: LucentInstance>(_ o: Swift.OpaquePointer?, _ make: (Swift.OpaquePointer) -> T) -> T {
    if let wrapper = lucentWrapper(o!) { return wrapper as! T }
    return make(o!)
  }

  static func instance<T: LucentInstance>(_ v: lucent_value, _ make: (Swift.OpaquePointer) -> T) -> T {
    instance(v.as.instance, make)
  }

  static func optional<T>(_ v: lucent_value, _ some: (lucent_value) -> T) -> T? { v.kind == LUCENT_NULL ? nil : some(v) }

  static func array<T>(_ v: lucent_value, _ item: (lucent_value) -> T) -> [T] {
    let a = v.as.array
    return (0..<a.length).map { item(a.items[$0]) }
  }

  static func record<T>(_ v: lucent_value, _ value: (lucent_value) -> T) -> [Swift.String: T] {
    let r = v.as.record
    var out: [Swift.String: T] = [:]
    for i in 0..<r.length { out[string(r.keys[i])] = value(r.values[i]) }
    return out
  }
}

/// An async entry's completion, as its caller's continuation: resumed once.
final class LucentAwait<T> {
  private let continuation: CheckedContinuation<T, Swift.Error>

  init(_ continuation: CheckedContinuation<T, Swift.Error>) { self.continuation = continuation }

  /// The completion's context: this, held until it settles.
  var context: Swift.UnsafeMutableRawPointer { Swift.Unmanaged.passRetained(self).toOpaque() }

  static func settle(_ context: Swift.UnsafeMutableRawPointer?, _ error: Swift.UnsafePointer<lucent_error>?, _ value: () -> T) {
    let awaiting = Swift.Unmanaged<LucentAwait<T>>.fromOpaque(context!).takeRetainedValue()
    if let error {
      awaiting.continuation.resume(throwing: LucentError(error.pointee))
    } else {
      awaiting.continuation.resume(returning: value())
    }
  }
}`;
