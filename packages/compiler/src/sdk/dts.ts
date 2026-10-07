import { classOrigin, memberOrigin, type OriginMember } from "./native-origin.ts";
import type { NamesIndex } from "@lucent-lang/bindgen";
import { ts } from "@lucent-lang/codegen";
import {
  isBigIntType,
  omitsKotlinDefault,
  ownTypes,
  planBinding,
  type Role,
  unsupportedReason,
} from "./plans.ts";
import {
  AUTO_CLOSEABLE,
  declaresPromise,
  findSdkType,
  formatSchemaType,
  mainThreadOnly,
  type Platform,
  parseSdkType,
  payloadFields,
  sdkTypeInfo,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SdkType,
} from "./schema.ts";
import { isViewClass, ROOT_VIEW, viewRules } from "./view-rules.ts";

/** Module specifier of an SDK module. */
export function sdkSpecifier(platform: Platform, module: string): string {
  return `lucent:${platform}/${module}`;
}

/**
 * TypeScript declarations for an SDK module. Classes are nominal (a private
 * brand), have a private constructor unless the SDK declares initializers,
 * and document their thread rule; the compiler maps the declarations back to
 * the schema by name and overload order.
 */
export function sdkDts(schema: SdkModuleSchema, options: DtsOptions = {}): string {
  const plain = emitDts(schema, new Map(), options);
  const aliases = importAliases(schema, plain.imports);

  return aliases.size ? emitDts(schema, aliases, options).text : plain.text;
}

/**
 * Imported names another declaration of the module already takes: a local
 * type (android.content's ClipboardManager extends android.text's), or the
 * same name from another module (java.math's and android.icu.math's
 * BigDecimal). Each is imported under its module's name
 * (`java_math_BigDecimal`), keyed `module name`.
 */
function importAliases(
  schema: SdkModuleSchema,
  imports: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const local = new Set(schema.types.map((t) => t.name));
  const modulesOf = new Map<string, string[]>();

  for (const [module, names] of imports)
    for (const name of names) modulesOf.set(name, [...(modulesOf.get(name) ?? []), module]);

  const aliases = new Map<string, string>();
  for (const [name, modules] of modulesOf)
    if (local.has(name) || modules.length > 1)
      for (const module of modules)
        aliases.set(`${module} ${name}`, `${moduleIdent(module)}_${name}`);

  return aliases;
}

/** A module as part of an identifier: `android/java.math` → `java_math`. */
const moduleIdent = (module: string) =>
  module
    .replace(/^lucent:/, "")
    .replace(/^(ios|android)\//, "")
    .replace(/\W/g, "_");

/** The declarations, with the imports they use; `aliases` renames colliding imports. */
/** What the declarations hold beyond the module's API. */
export interface DtsOptions {
  /** Each view class's JSX attributes (T48), which components read. */
  jsx?: boolean;
}

function emitDts(
  schema: SdkModuleSchema,
  aliases: ReadonlyMap<string, string>,
  options: DtsOptions,
): { text: string; imports: Map<string, Set<string>> } {
  const imports = new Map<string, Set<string>>();
  /** Imports `name` from `module`, and gives the name to reference it by. */
  const use = (module: string, name: string): string => {
    const names = imports.get(module) ?? new Set();
    names.add(name);
    imports.set(module, names);

    return aliases.get(`${module} ${name}`) ?? name;
  };
  /** `out`: results and properties; parameters take any Lucent value where Objective-C takes Any. */
  const tsType = (t: SdkType, out = true): ts.Type => {
    const base = ((): ts.Type => {
      switch (t.k) {
        case "prim":
          return ts.keyword(primKeyword(t));
        case "string":
          return ts.keyword("string");
        case "bytes":
          return ts.ref("Uint8Array");
        case "date":
          return ts.ref("Date");
        case "id": {
          const name = out ? "NSObject" : "ObjCValue";
          use("lucent:ios", name);
          return ts.ref(name);
        }
        case "record":
          return ts.ref("Record", ts.keyword("string"), tsType(t.of, out));
        case "out":
          use("lucent:ios", "Out");
          return ts.ref("Out", tsType(t.of, true));
        case "set":
          return ts.ref("Set", tsType(t.of, out));
        case "tuple":
          return ts.tuple(
            t.of.map((x, i) => ({
              type: tsType(x, out),
              ...(t.labels ? { name: t.labels[i]! } : {}),
            })),
          );
        case "array":
          if (t.of.k === "prim" && t.of.name === "byte" && !t.list) return ts.ref("Uint8Array");
          return ts.array(tsType(t.of, out));
        case "classOf":
          return ts.object([{ name: "prototype", type: ts.ref(t.param), readonly: true }]);
        case "error":
          return ts.ref("Error");
        case "fn":
          // The block's arguments come from the platform; its result goes back.
          return ts.fn(
            t.params.map((x, i) => ts.param(`arg${i}`, tsType(x, true))),
            tsType(t.ret, false),
          );
        case "tparam":
          // `Self` in a Swift protocol's requirement: the implementing class.
          return ts.ref(t.name === "Self" ? "this" : t.name);
        case "ref": {
          const name =
            t.module !== schema.module ? use(`${schema.platform}/${t.module}`, t.name) : t.name;
          const named = ts.ref(name, ...(t.args ?? []).map((a) => tsType(a, out)));
          // An option set's empty value, which no case names.
          if (isOptionSet(schema, t)) return ts.union([named, ts.literal(0)]);
          // Where a Java interface with one abstract method is taken, so is a
          // function (Android only: other iOS modules are not extracted for names).
          const target =
            out || schema.platform !== "android"
              ? undefined
              : t.module === schema.module
                ? schema.types.find((x) => x.name === t.name)
                : findSdkType(schema.platform, t.module, t.name);
          const sam =
            target?.kind === "class" && target.functional
              ? target.methods?.find((m) => m.name === target.functional && m.abstract)
              : undefined;
          if (!sam || target?.kind !== "class") return named;
          // A generic interface's method, with the reference's type arguments (unknown when raw).
          const bound = new Map(
            (target.typeParams ?? []).map((name, i): [string, SdkType] => [
              name,
              t.args?.[i] ?? { k: "tparam", name: "unknown", nullable: false },
            ]),
          );
          const typed = (s: Parameters<typeof parseSdkType>[0]) =>
            substitute(parseSdkType(s, t.module), bound);
          return ts.union([
            named,
            ts.fn(
              sam.params.map((p, i) => ts.param(`arg${i}`, tsType(typed(p.type), true))),
              tsType(typed(sam.returns), false),
            ),
          ]);
        }
      }
    })();
    return t.nullable ? ts.union([base, ts.nullType]) : base;
  };

  const body: ts.Decl[] = [];
  for (const type of schema.types) {
    if (type.kind === "enum")
      body.push(
        {
          k: "enum",
          name: type.name,
          members: type.cases.map((c) => ({ name: c.name, value: c.value })),
        },
        ts.blank,
      );
    else if (type.kind === "struct")
      // A C struct by value: a plain object type.
      body.push(
        {
          k: "typeAlias",
          name: type.name,
          type: ts.object(
            type.fields.map((f) => ({
              name: f.name,
              type: tsType(parseSdkType(f.type, schema.module)),
            })),
          ),
        },
        ts.blank,
      );
    else body.push(...classDts(schema, type, tsType, use, options), ts.blank);
  }
  const refused = refusalDoc(schema);
  const since = (v: number | string | undefined) =>
    v === undefined ? [] : [`Since ${schema.platform === "android" ? "API " : "iOS "}${v}.`];
  for (const f of schema.functions ?? []) {
    const tps = f.typeParams ?? [];
    const doc = [...since(f.since), ...[refused(undefined, f) ?? []].flat()];
    body.push({
      k: "function",
      name: f.name,
      ...(doc.length ? { doc } : {}),
      ...(tps.length ? { typeParams: tps.map((name) => ({ name })) } : {}),
      params: declaredParams(f, (t) => tsType(parseSdkType(t, schema.module, tps), false)),
      ret: settled(f, tsType(parseSdkType(f.returns, schema.module, tps))),
    });
  }
  for (const c of schema.constants ?? []) {
    const doc = [...since(c.since), ...[refused(undefined, c) ?? []].flat()];
    body.push({
      k: "const",
      name: c.name,
      type: tsType(parseSdkType(c.type, schema.module)),
      ...(doc.length ? { doc } : {}),
    });
  }
  const head: ts.Decl[] = [...imports].map(([module, names]) => ({
    k: "importType",
    names: [...names].sort().map((name) => {
      const alias = aliases.get(`${module} ${name}`);
      return alias ? `${name} as ${alias}` : name;
    }),
    from: module.startsWith("lucent:") ? module : `lucent:${module}`,
  }));
  // Implementation modules (`_LocationEssentials`) are re-exported by the
  // modules that use them, as their module maps' `export *` does: CLLocation
  // is imported from lucent:ios/CoreLocation.
  for (const module of reexports(schema, [...imports.keys()]))
    head.push({ k: "exportFrom", from: `lucent:${module}` });
  while (body.at(-1)?.k === "blank") body.pop();
  const text = ts.printUnit({
    banner: `Generated by Lucent from the ${schema.platform} binding schema of ${schema.module}. Do not edit.`,
    decls: [...head, ts.blank, ...body],
  });

  return { text, imports };
}

/** Whether `t` names an option set (NS_OPTIONS): this module's, or another's by its names. */
function isOptionSet(schema: SdkModuleSchema, t: SdkType & { k: "ref" }): boolean {
  if (schema.platform !== "ios") return false;
  if (t.module !== schema.module) return !!sdkTypeInfo("ios", t.module, t.name)?.options;

  const own = schema.types.find((x) => x.name === t.name);
  return own?.kind === "enum" && !!own.options;
}

type SchemaParam = {
  name: string;
  type: string | SdkType;
  defaulted?: "optional" | "omitted";
  kotlin?: { default?: true };
};

/** A member whose parameters a declaration lists: the facts that change its parameter list. */
type Declared = {
  params: SchemaParam[];
  typeParams?: string[];
  kotlin?: { suspend?: true };
  swift?: { async?: boolean };
};

/**
 * What a member's binding plans refuse, as its declaration documents it:
 * any use in its default role, or (a writable property) an assignment.
 * Plans made from the module's own types: the compile judges the others.
 */
function refusalDoc(schema: SdkModuleSchema) {
  const types = ownTypes(schema);
  const reason = (
    owner: SdkClassSchema | undefined,
    member: Parameters<typeof planBinding>[1],
    role?: Role,
  ) => unsupportedReason(planBinding(owner, member, schema, types, role));

  return (
    owner: SdkClassSchema | undefined,
    member: Parameters<typeof planBinding>[1],
  ): string | undefined => {
    const use = reason(owner, member);
    if (use) return `Lucent cannot use this yet: ${use}.`;

    const writable = "type" in member && !member.readonly && member.value === undefined;
    const set = writable ? reason(owner, member, "set") : undefined;
    return set ? `Lucent cannot assign this yet: ${set}.` : undefined;
  };
}

/**
 * Parameters as declared: Swift default arguments optional, or left out;
 * Kotlin defaults optional where a shim can leave them out (`owner` has the
 * type parameters that decide it). Only trailing ones: TypeScript requires
 * those after an optional parameter to be optional too; a Kotlin default
 * before a parameter without one takes `undefined`, which leaves it out. A
 * suspend function or a Swift async function takes an AbortSignal last,
 * which cancels it.
 */
function declaredParams(
  member: Declared,
  type: (t: string | SdkType) => ts.Type,
  owner?: { typeParams?: string[] },
): ts.Param[] {
  const used = new Set<string>();
  const ps = member.params.filter((p) => p.defaulted !== "omitted");
  const omissible = ps.map(
    (p) =>
      p.defaulted === "optional" ||
      omitsKotlinDefault(owner as SdkClassSchema | undefined, member as never, p as SdkParam),
  );
  const optional = omissible.map((o, i) => o && omissible.slice(i).every(Boolean));

  const params = ps.map((p, i) => {
    // Swift labels can repeat an internal name (dividerImage(state, state)).
    const name = used.has(safeName(p.name)) ? `${safeName(p.name)}_${i}` : safeName(p.name);
    used.add(name);

    if (optional[i]) return { ...ts.param(name, type(p.type)), optional: true };

    const leftOut = omissible[i] && !!p.kotlin?.default;
    return ts.param(
      name,
      leftOut ? ts.union([type(p.type), ts.keyword("undefined")]) : type(p.type),
    );
  });

  if (!member.kotlin?.suspend && !member.swift?.async) return params;

  const signal = used.has("signal") ? "abortSignal" : "signal";
  return [...params, { ...ts.param(signal, ts.ref("AbortSignal")), optional: true }];
}

/** What a member returns in Lucent: a promise, for async Swift members and Kotlin suspend functions. */
function settled(
  m: { swift?: { async?: boolean }; kotlin?: { suspend?: true } },
  ret: ts.Type,
): ts.Type {
  return m.swift?.async || m.kotlin?.suspend ? ts.ref("Promise", ret) : ret;
}

/** `t` with type parameters replaced by what `bound` gives them. */
export function substitute(t: SdkType, bound: ReadonlyMap<string, SdkType>): SdkType {
  switch (t.k) {
    case "tparam": {
      const to = bound.get(t.name);
      return to ? { ...to, nullable: to.nullable || t.nullable } : t;
    }
    case "ref":
      return t.args ? { ...t, args: t.args.map((a) => substitute(a, bound)) } : t;
    case "array":
    case "set":
    case "record":
    case "out":
      return { ...t, of: substitute(t.of, bound) };
    case "fn":
      return {
        ...t,
        params: t.params.map((p) => substitute(p, bound)),
        ret: substitute(t.ret, bound),
      };
    default:
      return t;
  }
}

/** The implementation modules (`ios/_Name`) a module's declarations re-export. */
export function reexports(schema: SdkModuleSchema, imported: string[]): string[] {
  return schema.platform === "ios" ? imported.filter((m) => m.startsWith("ios/_")) : [];
}

const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
]);
export function safeName(n: string): string {
  return RESERVED.has(n) ? `${n}_` : n;
}

function classDts(
  schema: SdkModuleSchema,
  cls: SdkClassSchema,
  tsType: (t: SdkType, out?: boolean) => ts.Type,
  use: (module: string, name: string) => string,
  options: DtsOptions,
): ts.Decl[] {
  const parse = (s: string | SdkType, tps: readonly string[] = []) =>
    parseSdkType(s, schema.module, tps);
  /**
   * The constants an @IntDef or @StringDef allows, as their literal types
   * (`typeof Toast.LENGTH_SHORT | typeof Toast.LENGTH_LONG`), or `type`.
   */
  const oneOf = (refs: string[] | undefined, type: SdkType, out: boolean): ts.Type => {
    if (!refs) return tsType(type, out);
    const union = ts.union(
      refs.map((r) => {
        const dot = r.lastIndexOf(".");
        const owner = parse(r.slice(0, dot));
        if (owner.k !== "ref") throw new Error(`constant ${r}`);
        const name =
          owner.module !== schema.module
            ? use(`${schema.platform}/${owner.module}`, owner.name)
            : owner.name;
        return ts.typeOf(`${name}.${r.slice(dot + 1)}`);
      }),
    );
    // On an array (varargs): its elements.
    const t = type.k === "array" ? ts.array(union) : union;
    return type.nullable ? ts.union([t, ts.nullType]) : t;
  };
  // `Self` in a Swift requirement: a parameter is `this`, a result the
  // protocol (TypeScript would take only `this` itself for a `this` result).
  const own: SdkType = {
    k: "ref",
    module: schema.module,
    name: cls.name,
    nullable: false,
    ...(cls.typeParams?.length
      ? { args: cls.typeParams.map((name) => ({ k: "tparam" as const, name, nullable: false })) }
      : {}),
  };
  const result = (t: SdkType) =>
    cls.swift?.kind === "protocol" ? substitute(t, new Map([["Self", own]])) : t;
  // Parameters keep their Java type: a constant outside the group is a warning (LUCENT3008).
  const params = (m: Declared, tps: readonly string[] = []) =>
    declaredParams(m, (t) => tsType(parse(t, tps), false), cls);
  // An enum with payloads: a union of its cases, discriminated by kind.
  const cases = cls.swift?.kind === "enum" ? cls.swift.cases : undefined;
  if (cases)
    return [
      {
        k: "typeAlias",
        name: cls.name,
        typeParams: distinctTypeParams(cls.typeParams ?? []).map((name) => ({
          name,
          default: ts.keyword("unknown"),
        })),
        type: ts.union(
          cases.map((c) => {
            const fields = payloadFields(c.params);
            return ts.object([
              { name: "kind", type: ts.literal(c.name) },
              ...c.params.map((p, i) => ({
                name: fields[i]!,
                type: tsType(parse(p.type, cls.typeParams)),
              })),
            ]);
          }),
        ),
      },
    ];
  const sinceText = (v: number | string | undefined) =>
    v === undefined ? undefined : `Since ${schema.platform === "android" ? "API " : "iOS "}${v}.`;
  const refused = refusalDoc(schema);
  // A member's thread line says where its rule differs from what the class's doc says.
  const threadDoc = (main: boolean) =>
    main === mainThreadOnly(cls)
      ? undefined
      : main
        ? "Main thread only: call it inside `main(() => …)`."
        : "Any thread: no `main(() => …)` needed.";
  const memberDoc = (
    m: Parameters<typeof planBinding>[1] & {
      since?: number | string;
      deprecated?: boolean;
      mainActor?: boolean;
      worker?: boolean;
    },
    // What it calls natively: a member the class declares (an inherited one is its superclass's).
    origin?: OriginMember,
    // The class declaring it, whose thread rule applies.
    owner: SdkClassSchema = cls,
  ) => {
    const parts = [
      sinceText(m.since),
      threadDoc(mainThreadOnly(owner, m)),
      m.worker ? "Blocks (@WorkerThread): call it outside `main(() => …)`." : undefined,
      refused(cls, m),
    ].filter(Boolean);
    // On a line of its own: where it comes from, beside what using it takes. A tag comes last:
    // it takes the text after it as its own.
    const lines = [
      ...(parts.length ? [parts.join(" ")] : []),
      ...(origin ? [`${memberOrigin(schema, cls, origin)}.`] : []),
      ...(m.deprecated ? ["@deprecated"] : []),
    ];
    return lines.length ? { doc: lines.length === 1 ? lines[0]! : lines } : {};
  };
  const doc: string[] = [`${classOrigin(schema, cls)}.`];
  if (mainThreadOnly(cls))
    doc.push("Main thread only: use it inside `main(() => …)` from lucent:thread.");
  if (cls.interface)
    doc.push(INTERFACE_DOC[cls.swift ? "swift" : cls.kotlin ? "kotlin" : schema.platform]);
  if (cls.since !== undefined) doc.push(sinceText(cls.since)!);
  // Objective-C classes are NSObjects, so they go where Any (id) is taken; Swift types are not.
  const nsObject = schema.platform === "ios" && !cls.extends && !cls.interface && !cls.swift;
  if (nsObject) use("lucent:ios", "NSObject");
  // Every Java class extends java.lang.Object (JLS 8.1.4): an Object result
  // narrows to a class, and a class goes where Object is taken.
  const javaObject =
    schema.platform === "android" &&
    !cls.extends &&
    !cls.interface &&
    cls.native !== JAVA_OBJECT &&
    !cls.swift;
  const ext = cls.extends
    ? tsType(parse(cls.extends))
    : nsObject
      ? ts.ref("NSObject")
      : javaObject
        ? tsType(parse("java.lang.Object"))
        : undefined;
  // Type parameters default to unknown, so raw references (`List`) stay valid.
  const typeParams = distinctTypeParams(cls.typeParams ?? []).map((name) => ({
    name,
    default: ts.keyword("unknown"),
  }));
  const members: ts.Member[] = [];
  const requiredAbove = cls.interface ? abstractAbove(schema, cls) : new Set<string>();
  // Protocols and Java interfaces are structural, so Lucent classes can
  // implement them; other classes are nominal.
  if (!cls.interface)
    members.push({
      k: "property",
      // A superclass of the same name has its own private brand: this one is told apart by its module.
      name: `__lucent_${namedLikeAncestor(schema, cls) ? `${moduleIdent(schema.module)}_` : ""}${cls.name}`,
      type: ts.keyword("never"),
      private: true,
      readonly: true,
    });
  if (!cls.constructors?.length && !cls.inheritsInit && !cls.interface)
    members.push({ k: "constructor", params: [], protected: true });
  for (const c of cls.constructors ?? [])
    members.push({
      k: "constructor",
      params: params(c),
      ...(c.protected ? { protected: true } : {}),
      ...memberDoc(c, { initializer: c }),
    });
  // A TypeScript class cannot have a property and a method of one name: the method stays.
  const methodNames = new Set((cls.methods ?? []).map((m) => `${!!m.static}:${m.name}`));
  for (const p of (cls.properties ?? []).filter(
    (x) => !methodNames.has(`${!!x.static}:${x.name}`),
  )) {
    // A constant has its value's literal type, so @IntDef groups can name it.
    const type =
      p.value !== undefined && p.static && p.readonly
        ? ts.literal(constantValue(parse(p.type), p.value))
        : settled(p, oneOf(p.oneOf, result(parse(p.type)), true));
    // Written on Android, it takes what a parameter of its type does: a function for a fun
    // interface. (On iOS, a type read and written alike: a subclass may redeclare it.)
    const set =
      p.readonly || schema.platform !== "android"
        ? undefined
        : oneOf(p.oneOf, parse(p.type), false);
    members.push({
      k: "property",
      name: p.name,
      type,
      ...(set && ts.printType(set) !== ts.printType(type) ? { set } : {}),
      ...(p.static ? { static: true } : {}),
      ...(p.readonly ? { readonly: true } : {}),
      ...memberDoc(p, { property: p }),
    });
  }
  for (const m of cls.methods ?? []) {
    // A static cannot name its class's type parameters: it takes those it uses.
    const tps = [
      ...(m.static
        ? classParamsUsed(cls.typeParams ?? [], [...m.params.map((p) => p.type), m.returns]).filter(
            (p) => !m.typeParams?.includes(p),
          )
        : []),
      ...(m.typeParams ?? []),
    ];
    // Optional protocol requirements, and Java interfaces' default methods, need no
    // implementation; but not a default a superinterface declares abstract, which
    // TypeScript's interface would then require (Deque.reversed, SequencedCollection's).
    const optional =
      m.optional ||
      (schema.platform === "android" &&
        cls.interface &&
        !m.abstract &&
        !m.static &&
        !requiredAbove.has(m.name));
    const shared = {
      ...(m.static ? { static: true } : {}),
      ...(tps.length ? { typeParams: tps.map((name) => ({ name })) } : {}),
    };
    members.push({
      k: "method",
      name: m.name,
      params: params(m, tps),
      ret: settled(m, oneOf(m.returnsOneOf, result(parse(m.returns, tps)), true)),
      ...(optional ? { optional: true } : {}),
      ...shared,
      ...memberDoc(m, { method: m }),
    });
    // Without its completion handler: a promise of what the handler receives.
    if (m.async && declaresPromise(cls, m))
      members.push({
        k: "method",
        name: m.async.name ?? m.name,
        params: params({ params: m.params.slice(0, -1) }, tps),
        ret: ts.ref("Promise", tsType(parse(m.async.returns, tps))),
        ...shared,
        ...memberDoc(m, { method: m, promise: true }),
      });
  }
  // Java and Objective-C inherit the overloads a subclass does not override;
  // TypeScript hides them all once a subclass declares one, so they are
  // declared again, tagged with the class declaring them.
  for (const inh of inheritedOverloads(schema, cls)) {
    const m = inh.method;
    const tps = m.typeParams ?? [];
    const typed = (t: string | SdkType) =>
      substitute(parseSdkType(t, inh.module, [...inh.classTypeParams, ...tps]), inh.bound);
    const doc = [
      memberDoc(m, undefined, inh.owner).doc,
      `${INHERITED_TAG} ${inh.module}.${inh.owner.name} ${inh.index}`,
    ];

    // Overloads share their optionality: as the class's own of this name; one an
    // interface declares only for its supertypes is optional unless one requires it.
    const sameName = members.filter(
      (x) => x.k === "method" && x.name === m.name && !!x.static === !!m.static,
    );
    const optional = sameName.length
      ? sameName.some((x) => x.k === "method" && x.optional)
      : schema.platform === "android" && !!cls.interface && !m.static && !requiredAbove.has(m.name);

    members.push({
      k: "method",
      name: m.name,
      params: declaredParams(m, (t) => tsType(typed(t), false), {
        typeParams: [...inh.classTypeParams],
      }),
      ret: settled(m, oneOf(m.returnsOneOf, typed(m.returns), true)),
      ...(m.static ? { static: true } : {}),
      ...(tps.length ? { typeParams: tps.map((name) => ({ name })) } : {}),
      ...(optional ? { optional: true } : {}),
      doc: doc.filter(Boolean).join(" "),
    });
  }

  for (const inh of propertiesGivenTwoWays(schema, cls)) {
    const p = inh.property;
    const doc = [
      memberDoc(p, undefined, inh.owner).doc,
      `${INHERITED_TAG} ${inh.module}.${inh.owner.name} ${inh.index}`,
    ];

    members.push({
      k: "property",
      name: p.name,
      type: settled(p, oneOf(p.oneOf, inh.type, true)),
      ...(p.readonly ? { readonly: true } : {}),
      doc: doc.filter(Boolean).join(" "),
    });
  }

  // Java's AutoCloseable is disposable, and so what extends or implements it
  // (Closeable, Cursor…): a using declaration closes it.
  if (schema.platform === "android" && cls.native === AUTO_CLOSEABLE)
    members.push({ k: "method", name: "[Symbol.dispose]", params: [], ret: ts.keyword("void") });
  // What the class adds to its JSX tag's attributes (T48), under a key of its own, so that
  // each class's keeps `this`; the root view's `~jsx` is them all, the tag's attributes.
  const jsx = options.jsx ? jsxAttributes(schema, cls, tsType, parse) : undefined;
  if (jsx?.root)
    members.push({
      k: "property",
      name: "~jsx",
      type: ts.ref(use("lucent:ui", "NativeAttributes"), ts.ref("this")),
      readonly: true,
      optional: true,
      doc: "The JSX attributes of this view's tag: its classes' `~jsx:` keys, together.",
    });
  if (jsx?.decl)
    members.push({
      k: "property",
      name: `~jsx:${schema.module}.${cls.name}`,
      type: ts.ref(jsx.name, ts.ref("this"), ...typeParams.map((t) => ts.ref(t.name))),
      readonly: true,
      optional: true,
      doc: "The JSX attributes this class gives its tag, derived by rule from its declarations.",
    });
  // Interfaces and abstract classes cannot be constructed; implemented
  // interfaces merge into the class type below, so values convert to them.
  const out: ts.Decl[] = [
    {
      k: "class",
      name: cls.name,
      ...(cls.interface || cls.abstract ? { abstract: true } : {}),
      ...(doc.length ? { doc } : {}),
      typeParams,
      ...(ext ? { extends: ext } : {}),
      members,
    },
  ];
  // CharSequence is a string in Lucent: not an object type TypeScript can extend.
  const supers = declaredInterfaces(schema, cls)
    .filter((i) => parse(i).k === "ref")
    .map((i) => tsType(parse(i)));
  if (supers.length)
    out.push({ k: "interface", name: cls.name, typeParams, extends: supers, members: [] });
  if (jsx?.decl) out.push(jsx.decl);
  return out;
}

/**
 * The attributes a view class itself gives its JSX tag (T48), as a
 * module-local interface of the tag's class (`Self`: a control's handler
 * gets it): props and events, each documented with the rule that made it;
 * and whether it is the root view, which gathers its subclasses' keys. None
 * for a class that is no view.
 */
function jsxAttributes(
  schema: SdkModuleSchema,
  cls: SdkClassSchema,
  tsType: (t: SdkType, out?: boolean) => ts.Type,
  parse: (s: string | SdkType) => SdkType,
): { name: string; root: boolean; decl?: ts.Decl } | undefined {
  const find = (module: string, name: string) => findSdkType(schema.platform, module, name);
  if (cls.interface || !isViewClass(cls, schema, find)) return undefined;

  const view = ROOT_VIEW[schema.platform];
  const root = schema.module === view.module && cls.name === view.name;
  const rules = viewRules(cls, schema, find);
  // Children are views of the platform: what a JSX element is, as a component returns it.
  const childrenMember = (c: { explanation: string }): ts.Member => {
    // A view, or a conditional child's nothing (`cond && <X/>`); a list's views (`.map`) among them.
    const one = ts.union([
      tsType(parseSdkType(`${view.module}.${view.name}`), false),
      ts.literal(false),
      ts.nullType,
      ts.keyword("undefined"),
    ]);
    const many = ts.readonlyArray(ts.union([one, ts.readonlyArray(one)]));

    return {
      k: "property",
      name: "children",
      type: ts.union([one, many]),
      optional: true,
      doc: c.explanation,
    };
  };
  const name = `__jsx_${cls.name}`;
  if (!rules.props.length && !rules.events.length && !rules.children)
    return root ? { name, root } : undefined;

  const props = rules.props.map((p): ts.Member => ({
    k: "property",
    name: p.name,
    type:
      p.kind === "property"
        ? tsType(parse(p.member.type), false)
        : ts.union(p.overloads.map((m) => tsType(parse(m.params[0]!.type), false))),
    optional: true,
    doc: p.explanation,
  }));
  const events = rules.events.map((e): ts.Member => ({
    k: "property",
    name: e.name,
    type:
      e.kind === "listener"
        ? ts.fn(
            e.method.params.map((x, i) =>
              ts.param(`arg${i}`, tsType(parseSdkType(x.type, e.listener.module), true)),
            ),
            tsType(parseSdkType(e.method.returns, e.listener.module), false),
          )
        : ts.fn([ts.param("control", ts.ref("Self"))], ts.keyword("void")),
    optional: true,
    doc: e.explanation,
  }));
  return {
    name,
    root,
    decl: {
      k: "interface",
      name,
      local: true,
      // The class's own type parameters too: a generic view's setters take them.
      typeParams: [
        { name: "Self" },
        ...distinctTypeParams(cls.typeParams ?? []).map((name) => ({
          name,
          default: ts.keyword("unknown"),
        })),
      ],
      members: [...props, ...events, ...(rules.children ? [childrenMember(rules.children)] : [])],
    },
  };
}

/** Whether a superclass of `cls`, however far up, has its simple name. */
function namedLikeAncestor(schema: SdkModuleSchema, cls: SdkClassSchema): boolean {
  let ext = cls.extends ? parseSdkType(cls.extends, schema.module) : undefined;

  // On iOS within the module: Objective-C class names are global, and reading
  // another module's schema would extract it just for this.
  for (let depth = 0; ext?.k === "ref" && depth < 32; depth++) {
    if (ext.name === cls.name) return true;

    const up = resolveSupertype(schema, ext);
    ext = up?.cls.extends ? parseSdkType(up.cls.extends, up.ref.module) : undefined;
  }

  return false;
}

/**
 * The names of the instance methods an interface's superinterfaces declare
 * abstract, transitively (on iOS, within the module).
 */
function abstractAbove(schema: SdkModuleSchema, cls: SdkClassSchema): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const pending = (cls.implements ?? []).map((i) => ({ ref: i, from: schema.module }));

  while (pending.length) {
    const { ref, from } = pending.shift()!;
    const t = parseSdkType(ref, from);
    if (t.k !== "ref" || (schema.platform === "ios" && t.module !== schema.module)) continue;

    const id = `${t.module}.${t.name}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const found =
      t.module === schema.module
        ? schema.types.find((x) => x.name === t.name)
        : findSdkType(schema.platform, t.module, t.name);
    if (found?.kind !== "class") continue;

    for (const m of found.methods ?? []) if (m.abstract && !m.static) out.add(m.name);

    for (const next of [...(found.extends ? [found.extends] : []), ...(found.implements ?? [])])
      pending.push({ ref: next, from: t.module });
  }

  return out;
}

/**
 * The JSDoc tag on an inherited overload declared again in a subclass:
 * `@lucentInherited <module>.<Class> <index>`, the declaring class and the
 * method's index in its schema. The compiler calls that method.
 */
export const INHERITED_TAG = "@lucentInherited";

/** What an interface is, by the language declaring it. */
const INTERFACE_DOC: Record<Platform | "swift" | "kotlin", string> = {
  swift: "A Swift protocol.",
  kotlin: "A Kotlin interface.",
  ios: "An Objective-C protocol.",
  android: "A Java interface.",
};

const JAVA_OBJECT = "java/lang/Object";

interface InheritedOverload {
  module: string;
  owner: SdkClassSchema;
  index: number;
  method: SdkMethodSchema;
  /** The declaring class's type parameters, which its methods' types name. */
  classTypeParams: readonly string[];
  /** The declaring class's type parameters, as the subclass binds them. */
  bound: ReadonlyMap<string, SdkType>;
}

/**
 * A supertype reference, resolved to its class: on iOS only in this module
 * (others would have to be extracted just for this).
 */
function resolveSupertype(
  schema: SdkModuleSchema,
  t: SdkType,
): { ref: SdkType & { k: "ref" }; cls: SdkClassSchema } | undefined {
  if (t.k !== "ref" || (schema.platform === "ios" && t.module !== schema.module)) return undefined;

  const found =
    t.module === schema.module
      ? schema.types.find((x) => x.name === t.name)
      : findSdkType(schema.platform, t.module, t.name);
  return found?.kind === "class" ? { ref: t, cls: found } : undefined;
}

/** A class's type arguments for a supertype's parameters. */
function bindSupertype(
  sup: SdkClassSchema,
  ref: SdkType & { k: "ref" },
  bound: ReadonlyMap<string, SdkType>,
): Map<string, SdkType> {
  return new Map(
    (sup.typeParams ?? []).map((n, i): [string, SdkType] => [
      n,
      ref.args?.[i]
        ? substitute(ref.args[i]!, bound)
        : { k: "tparam", name: "unknown", nullable: false },
    ]),
  );
}

interface InheritedProperty {
  module: string;
  owner: SdkClassSchema;
  index: number;
  property: SdkPropertySchema;
  /** Its type, as the class binds the declaring class's type parameters. */
  type: SdkType;
}

/**
 * The properties a class inherits from its superclasses and from the
 * interfaces it adopts, typed two ways (View's layoutDirection, typed by
 * its constants, and ViewParent's, a number, in ViewGroup): TypeScript
 * refuses to merge them, so the class declares the superclass's, which
 * implements the interface's. Those it declares itself, as a property or
 * a method, stay its own.
 */
function propertiesGivenTwoWays(schema: SdkModuleSchema, cls: SdkClassSchema): InheritedProperty[] {
  const own = new Set([
    ...(cls.properties ?? []).filter((p) => !p.static).map((p) => p.name),
    ...(cls.methods ?? []).filter((m) => !m.static).map((m) => m.name),
  ]);
  const shape = (p: SdkPropertySchema, type: SdkType) =>
    `${formatSchemaType(type)} ${(p.oneOf ?? []).join(",")} ${!!p.readonly}`;
  const typed = (
    p: SdkPropertySchema,
    sup: SdkClassSchema,
    module: string,
    bound: ReadonlyMap<string, SdkType>,
  ) => substitute(parseSdkType(p.type, module, sup.typeParams ?? []), bound);

  // The superclasses' properties, the nearest first.
  const fromSupers = new Map<string, InheritedProperty>();
  let ext = cls.extends
    ? parseSdkType(cls.extends, schema.module, cls.typeParams ?? [])
    : undefined;
  let bound: ReadonlyMap<string, SdkType> = new Map();

  for (let depth = 0; ext && depth < 32; depth++) {
    const sup = resolveSupertype(schema, ext);
    if (!sup) break;

    const supBound = bindSupertype(sup.cls, sup.ref, bound);
    (sup.cls.properties ?? []).forEach((property, index) => {
      if (property.static || own.has(property.name) || fromSupers.has(property.name)) return;

      const type = typed(property, sup.cls, sup.ref.module, supBound);
      fromSupers.set(property.name, {
        module: sup.ref.module,
        owner: sup.cls,
        index,
        property,
        type,
      });
    });

    ext = sup.cls.extends
      ? parseSdkType(sup.cls.extends, sup.ref.module, sup.cls.typeParams ?? [])
      : undefined;
    bound = supBound;
  }

  // The interfaces it adopts, and theirs: a property typed another way.
  const out = new Map<string, InheritedProperty>();
  const visited = new Set<string>();
  const queue = (cls.implements ?? []).flatMap((i) => {
    const p = resolveSupertype(schema, parseSdkType(i, schema.module, cls.typeParams ?? []));
    return p ? [{ ...p, bound: bindSupertype(p.cls, p.ref, new Map()) }] : [];
  });

  while (queue.length) {
    const p = queue.shift()!;
    const id = `${p.ref.module}.${p.cls.name}`;
    if (visited.has(id)) continue;
    visited.add(id);

    for (const property of p.cls.properties ?? []) {
      const inherited = fromSupers.get(property.name);
      if (property.static || !inherited) continue;

      const type = typed(property, p.cls, p.ref.module, p.bound);
      if (shape(property, type) !== shape(inherited.property, inherited.type))
        out.set(property.name, inherited);
    }

    for (const s of [...(p.cls.extends ? [p.cls.extends] : []), ...(p.cls.implements ?? [])]) {
      const sup = resolveSupertype(schema, parseSdkType(s, p.ref.module, p.cls.typeParams ?? []));
      if (sup) queue.push({ ...sup, bound: bindSupertype(sup.cls, sup.ref, p.bound) });
    }
  }

  return [...out.values()].sort((a, b) => (a.property.name < b.property.name ? -1 : 1));
}

/** A method's parameter types, nullability aside: what tells overloads apart. */
function overloadKey(
  m: SdkMethodSchema,
  module: string,
  classTypeParams: readonly string[],
  bound: ReadonlyMap<string, SdkType>,
): string {
  const tps = [...classTypeParams, ...(m.typeParams ?? [])];
  const types = m.params.map((p) =>
    formatSchemaType(substitute(parseSdkType(p.type, module, tps), bound)),
  );

  return `${!!m.static}:${m.name}(${types.join(",").replace(/\?/g, "")})`;
}

/**
 * The overloads of the methods `cls` declares that its superclasses declare
 * and it does not. On iOS only superclasses in the same module are read:
 * others would have to be extracted just for their declarations.
 */
function inheritedOverloads(schema: SdkModuleSchema, cls: SdkClassSchema): InheritedOverload[] {
  const nameOf = (m: SdkMethodSchema) => `${!!m.static}:${m.name}`;
  const own = new Set((cls.methods ?? []).map(nameOf));
  const seen = new Set(
    (cls.methods ?? []).map((m) => overloadKey(m, schema.module, cls.typeParams ?? [], new Map())),
  );
  const out: InheritedOverload[] = [];
  const resolve = (t: SdkType) => resolveSupertype(schema, t);

  const take = (
    sup: SdkClassSchema,
    module: string,
    bound: ReadonlyMap<string, SdkType>,
    names: ReadonlySet<string>,
  ) =>
    (sup.methods ?? []).forEach((m, index) => {
      if (!names.has(nameOf(m))) return;

      const classTypeParams = sup.typeParams ?? [];
      const key = overloadKey(m, module, classTypeParams, bound);
      if (seen.has(key)) return;

      seen.add(key);
      out.push({ module, owner: sup, index, method: m, classTypeParams, bound });
    });

  // The protocols (interfaces) it adopts itself: their overloads of its own
  // methods, and the names its superclasses may declare differently.
  const protocols = (cls.implements ?? [])
    .map((i) => resolve(parseSdkType(i, schema.module, cls.typeParams ?? [])))
    .filter((p) => !!p);
  // Those names come through superprotocols too: BlockingQueue's addAll is Collection's.
  const protocolNames = new Set<string>();
  const named = new Set<string>();

  for (const pending = [...protocols]; pending.length;) {
    const p = pending.shift()!;
    const id = `${p.ref.module}.${p.cls.name}`;
    if (named.has(id)) continue;
    named.add(id);

    for (const m of p.cls.methods ?? []) if (!m.static) protocolNames.add(nameOf(m));

    for (const s of [...(p.cls.extends ? [p.cls.extends] : []), ...(p.cls.implements ?? [])]) {
      const sup = resolve(parseSdkType(s, p.ref.module, p.cls.typeParams ?? []));
      if (sup) pending.push(sup);
    }
  }

  // Names two of its direct supertypes declare, each through its own
  // hierarchy (Editable's getChars, GetChars's and CharSequence's through
  // Spannable): merged, they would be declared two ways, so it declares them.
  const branchNames = (start: SdkType | undefined): Set<string> => {
    const names = new Set<string>();
    const walked = new Set<string>();

    for (const pending = start ? [start] : []; pending.length;) {
      const sup = resolve(pending.shift()!);
      if (!sup) continue;

      const id = `${sup.ref.module}.${sup.cls.name}`;
      if (walked.has(id)) continue;
      walked.add(id);

      for (const m of sup.cls.methods ?? []) if (!m.static) names.add(nameOf(m));

      for (const s of [
        ...(sup.cls.extends ? [sup.cls.extends] : []),
        ...(sup.cls.implements ?? []),
      ])
        pending.push(parseSdkType(s, sup.ref.module, sup.cls.typeParams ?? []));
    }

    return names;
  };
  const branches = [
    ...(cls.extends ? [parseSdkType(cls.extends, schema.module, cls.typeParams ?? [])] : []),
    ...(cls.implements ?? []).map((i) => parseSdkType(i, schema.module, cls.typeParams ?? [])),
  ].map(branchNames);
  const counted = new Map<string, number>();
  for (const b of branches) for (const n of b) counted.set(n, (counted.get(n) ?? 0) + 1);
  const shared = [...counted].filter(([, n]) => n > 1).map(([name]) => name);
  const declared = new Set([...own, ...shared]);

  // Superclasses: overloads of its own methods, and of its protocols' methods
  // (which merging would otherwise see declared two ways).
  const fromSupers = new Set([...declared, ...protocolNames]);
  // A Java class without a superclass extends Object, whose overloads it hides too (notify()).
  const superOf = (c: SdkClassSchema, module: string): SdkType | undefined =>
    c.extends
      ? parseSdkType(c.extends, module, c.typeParams ?? [])
      : schema.platform === "android" && !c.interface && c.native !== JAVA_OBJECT
        ? parseSdkType("java.lang.Object", module)
        : undefined;

  let ext = superOf(cls, schema.module);
  let bound: ReadonlyMap<string, SdkType> = new Map();
  // The interfaces superclasses implement merge into their types too (Chronology into
  // AbstractChronology): their overloads of its own methods, after its own protocols'.
  const inheritedProtocols: {
    ref: SdkType & { k: "ref" };
    cls: SdkClassSchema;
    bound: ReadonlyMap<string, SdkType>;
  }[] = [];

  for (let depth = 0; ext && depth < 32; depth++) {
    const sup = resolve(ext);
    if (!sup) break;

    const supBound = bindSupertype(sup.cls, sup.ref, bound);
    take(sup.cls, sup.ref.module, supBound, fromSupers);

    for (const i of sup.cls.implements ?? []) {
      const p = resolve(parseSdkType(i, sup.ref.module, sup.cls.typeParams ?? []));
      if (p) inheritedProtocols.push({ ...p, bound: bindSupertype(p.cls, p.ref, supBound) });
    }

    ext = superOf(sup.cls, sup.ref.module);
    bound = supBound;
  }

  // Protocols and their own superprotocols, nearest first.
  const queue = [
    ...protocols.map((p) => ({ ...p, bound: bindSupertype(p.cls, p.ref, new Map()) })),
    ...inheritedProtocols,
  ];
  const visited = new Set<string>();

  while (queue.length) {
    const p = queue.shift()!;
    const id = `${p.ref.module}.${p.cls.name}`;
    if (visited.has(id)) continue;
    visited.add(id);

    take(p.cls, p.ref.module, p.bound, declared);

    for (const s of [...(p.cls.extends ? [p.cls.extends] : []), ...(p.cls.implements ?? [])]) {
      const sup = resolve(parseSdkType(s, p.ref.module, p.cls.typeParams ?? []));
      if (sup) queue.push({ ...sup, bound: bindSupertype(sup.cls, sup.ref, p.bound) });
    }
  }

  return out;
}

/**
 * Declarations for a module the program does not import: its types' names,
 * enough for the signatures of modules it does import. Members need the
 * module imported (then it gets full declarations).
 */
export function stubDts(platform: Platform, module: string, names: NamesIndex): string {
  const decls: ts.Decl[] = [];
  if (platform === "ios") decls.push({ k: "importType", names: ["NSObject"], from: "lucent:ios" });
  decls.push(ts.blank);
  // By name: the graph's order changes between extractions.
  for (const [name, t] of Object.entries(names.types).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (t.kind === "enum") decls.push({ k: "enum", name, members: [] });
    else if (t.kind === "struct")
      decls.push({
        k: "typeAlias",
        name,
        type: ts.object(
          t.fields
            ? t.fields.map((f) => ({
                name: f.name,
                type: stubFieldType(parseSdkType(f.type, module)),
              }))
            : [
                {
                  name: `__lucent_struct_${name}`,
                  type: ts.keyword("never"),
                  readonly: true,
                  optional: true,
                },
              ],
        ),
      });
    else if (t.kind === "protocol")
      decls.push({ k: "class", name, abstract: true, typeParams: stubTypeParams(t), members: [] });
    else
      decls.push({
        k: "class",
        name,
        typeParams: stubTypeParams(t),
        ...(platform === "ios" && !t.swift ? { extends: ts.ref("NSObject") } : {}),
        members: [
          {
            k: "property",
            name: `__lucent_${name}`,
            type: ts.keyword("never"),
            private: true,
            readonly: true,
          },
          { k: "constructor", params: [], protected: true },
        ],
      });
  }
  return ts.printUnit({
    banner: `Names only: import lucent:${platform}/${module} in a platform file to use these types' members. Generated by Lucent. Do not edit.`,
    decls,
  });
}

/**
 * A nested generic type can repeat its outer type's parameter name, which
 * it then shadows: the last one keeps the name its members use, the ones
 * before it are renamed.
 */
function distinctTypeParams(names: readonly string[]): string[] {
  return names.map((n, i) => (names.indexOf(n, i + 1) >= 0 ? `${n}_${i}` : n));
}

/**
 * The interfaces (protocols) a class declares, without those another listed
 * supertype already extends: a class whose superclass is hidden lists that
 * superclass's interfaces, and merging an interface beside one that
 * redeclares its members does not type-check. On iOS only the module's own
 * supertypes are read.
 */
function declaredInterfaces(schema: SdkModuleSchema, cls: SdkClassSchema): string[] {
  const listed = cls.implements ?? [];
  if (listed.length < 2 && !cls.extends) return listed;

  const find = (ref: string, from: string) => {
    const t = parseSdkType(ref, from);
    if (t.k !== "ref" || (schema.platform === "ios" && t.module !== schema.module))
      return undefined;

    const found =
      t.module === schema.module
        ? schema.types.find((x) => x.name === t.name)
        : findSdkType(schema.platform, t.module, t.name);
    return found?.kind === "class"
      ? { id: `${t.module}.${t.name}`, cls: found, module: t.module }
      : undefined;
  };

  // Everything a supertype extends, transitively, by `module.Name`.
  const above = (ref: string, from: string, into = new Set<string>(), depth = 0): Set<string> => {
    const t = find(ref, from);
    if (!t || depth > 64) return into;

    for (const next of [...(t.cls.extends ? [t.cls.extends] : []), ...(t.cls.implements ?? [])]) {
      const n = find(next, t.module);
      if (n && !into.has(n.id)) {
        into.add(n.id);
        above(next, t.module, into, depth + 1);
      }
    }
    return into;
  };

  const implied = new Set<string>();
  for (const ref of listed) for (const id of above(ref, schema.module)) implied.add(id);

  // The superclass and what it extends and implements.
  if (cls.extends) {
    const sup = find(cls.extends, schema.module);
    if (sup) implied.add(sup.id);
    for (const id of above(cls.extends, schema.module)) implied.add(id);
  }

  return listed.filter((ref) => {
    const t = parseSdkType(ref, schema.module);
    return t.k !== "ref" || !implied.has(`${t.module}.${t.name}`);
  });
}

/** Which of `classParams` the (written or parsed) types mention. */
function classParamsUsed(classParams: readonly string[], types: (string | SdkType)[]): string[] {
  if (!classParams.length) return [];

  const used = new Set<string>();
  const walk = (t: string | SdkType) => {
    const text = typeof t === "string" ? t : formatSchemaType(t);
    for (const p of classParams) if (new RegExp(`\\b${p}\\b`).test(text)) used.add(p);
  };
  types.forEach(walk);

  return classParams.filter((p) => used.has(p));
}

/** A names-only generic type's parameters: named by position, `unknown` when left out. */
function stubTypeParams(t: { typeParams?: number }): { name: string; default: ts.Type }[] {
  return Array.from({ length: t.typeParams ?? 0 }, (_, i) => ({
    name: `T${i}`,
    default: ts.keyword("unknown"),
  }));
}

/** A names-only struct field's type: a number, a bigint, or a type of the same module. */
function stubFieldType(t: SdkType): ts.Type {
  if (t.k === "ref") return ts.ref(t.name);
  return ts.keyword(t.k === "prim" ? primKeyword(t) : "number");
}

/** A primitive's TypeScript type: native 64-bit integers are bigints (but a constant group's). */
function primKeyword(t: SdkType & { k: "prim" }): "void" | "boolean" | "bigint" | "number" {
  if (t.name === "void") return "void";
  if (t.name === "boolean" || t.name === "bool") return "boolean";

  return isBigIntType(t) ? "bigint" : "number";
}

/** A constant's value as its literal: a bigint's (decimal digits in the schema) a bigint. */
function constantValue(
  t: SdkType,
  value: number | string | boolean,
): number | bigint | string | boolean {
  return isBigIntType(t) ? BigInt(value) : value;
}
