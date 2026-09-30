/**
 * lucent:compose's declarations, made from Compose's schemas
 * (compose-schemas.ts) by rules, and what each stands for in Kotlin: the
 * binding the content writer (compose.ts) reads for every declaration a
 * body calls or reads.
 *
 * Compose is bound as it is, in call form:
 *
 * - a composable that emits UI (its applier is UI's) takes its named
 *   parameters as one object and its trailing content lambda last, and
 *   returns `Composed`: `Box({ modifier }, () => […])`;
 * - any other function takes Kotlin's parameters in order, those with
 *   defaults optional; when every one has a default (`spring`,
 *   `Modifier.offset`) they are one options object, and when a default
 *   comes before a parameter without one (`Modifier.clickable`'s onClick),
 *   the ones without are first, then the options object;
 * - a class is an interface (a brand keeps it nominal) with its instance
 *   members and the extensions of it (`Modifier.padding(…)` chains); its
 *   constructors are functions of its name, as Kotlin calls them, beside
 *   same-named factory functions (`Color(0xff…)`); its companion's or
 *   object's members are a namespace (`Color.White`); a companion that is
 *   a value of its class makes the name a value (`Modifier`);
 * - an extension property of a number is a function of it (`dp(20)` is
 *   `20.dp`);
 * - Kotlin's Float, Int, Long, Short and Byte are branded numbers, so
 *   generics keep them (`State<Float>`); a suspend function returns a
 *   promise, and a lambda's result that only its receiver makes is the
 *   function it gives that receiver's member (DisposableEffect's
 *   onDispose).
 *
 * Members a binding plan refuses are left out, as are defaulted
 * parameters whose values content cannot write. Overloads TypeScript
 * cannot tell apart once numbers are numbers keep one name for the one
 * taking the widest numbers (a Double holds any JavaScript number) and
 * rename the others (`RoundedCornerShape_Float`); two packages' classes of
 * one name keep the first package's.
 */
import {
  declarationFacts,
  planBinding,
  takenReason,
  unsupportedReason,
  type TypeLookup,
} from "@lucent-lang/bindgen";
import { ts } from "@lucent-lang/codegen";
import {
  parseSdkType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SdkType,
} from "../sdk/schema.ts";
import { composeSchemas } from "./compose-schemas.ts";

export type ComposeMember = SdkMethodSchema | SdkPropertySchema | SdkCallable;

/** How content writes a declaration's use in Kotlin. */
export interface ComposeWrite {
  /**
   * `top`: `name(…)` or `name`; `extension`: `receiver.name(…)`, the
   * receiver the object the method is called on or (`receiverArg`) the
   * call's first argument; `member`: `object.name(…)`; `static`:
   * `Owner.name(…)`.
   */
  k: "top" | "extension" | "member" | "static";
  /** The Kotlin name: a function's or property's, or a constructor's class (`PaddingValues.Absolute`). */
  name: string;
  /** For `static`: the class it is called on (`Alignment`, `Arrangement`). */
  owner?: string;
  /** What the Kotlin file imports for it. */
  imports: string[];
  /** Read, not called. */
  property?: true;
  /** An extension of a number or a string: the call's first argument is its receiver. */
  receiverArg?: true;
}

/**
 * A TypeScript parameter: one Kotlin parameter (an index of the member's
 * `params`), or an object of named ones; an element's props give its
 * trailing content lambda as their `children`.
 */
export type ComposeArg =
  | { k: "param"; index: number }
  | { k: "named"; indices: number[]; children?: number };

/** What a declaration of lucent:compose stands for. */
export interface ComposeBinding {
  module: SdkModuleSchema;
  owner?: SdkClassSchema;
  member: ComposeMember;
  write: ComposeWrite;
  /** A callable's TypeScript parameters, in order. */
  args?: ComposeArg[];
}

export interface ComposeDeclarations {
  /** The generated declarations, which follow lucent:compose's own. */
  text: string;
  /** Bindings by bindingKey, in the order of the declarations of that key. */
  bindings: ReadonlyMap<string, readonly ComposeBinding[]>;
}

/** What a declaration is: a function or constant of a namespace (or of the module), or an interface's member. */
export type DeclarationKind = "function" | "const" | "method" | "property";

/** The key of declarations of one name and kind in one container (`Color` for its namespace or interface). */
export const bindingKey = (container: string, kind: DeclarationKind, name: string) =>
  `${container}|${kind}|${name}`;

const UI_APPLIER = "androidx.compose.ui.UiComposable";

/**
 * Whether a member is a composable emitting UI, its own or (an applier
 * variable) its content's: what content shows (`Composed`).
 */
export function emitsUi(member: ComposeMember): boolean {
  const applier = member.kotlin?.applier;

  return (
    !!member.kotlin?.composable &&
    (applier === UI_APPLIER || applier === "*") &&
    "returns" in member &&
    member.returns.k === "prim" &&
    member.returns.name === "void"
  );
}

/**
 * Whether a member is a list's element (LazyListScope's `items`): a
 * function of a scope, emitting nothing itself, that takes the content it
 * adds last. Its scope is one whose receiver lambdas give elements.
 */
function addsContent(member: ComposeMember, owner: SdkClassSchema | undefined): boolean {
  return (
    !member.kotlin?.composable &&
    (!!member.kotlin?.scope || !!owner?.kotlin?.scope) &&
    "returns" in member &&
    member.returns.k === "prim" &&
    member.returns.name === "void" &&
    member.params.at(-1)?.kotlin?.role === "content"
  );
}

/**
 * Whether a member is written as a JSX element: a composable showing UI
 * (`<Box>`), or what a list's scope adds (`<list.items>`).
 */
export function isElement(member: ComposeMember, owner?: SdkClassSchema): boolean {
  return emitsUi(member) || addsContent(member, owner);
}

/**
 * Whether a callback parameter is a lambda of one of `scopes` (LazyColumn's
 * content, a LazyListScope's): it adds the elements its function returns.
 */
export function givesElementsIn(scopes: ReadonlySet<string>, param: SdkParam): boolean {
  const r = param.kotlin?.receiver;

  return (
    param.kotlin?.role === "callback" &&
    !param.kotlin.suspendFunction &&
    r?.k === "ref" &&
    scopes.has(`${r.module}.${r.name}`)
  );
}

let scopesOfElements: ReadonlySet<string> | undefined;

/** The scopes of Compose's schemas whose receiver lambdas give elements (LazyListScope), by class key. */
export function listScopes(): ReadonlySet<string> {
  scopesOfElements ??= elementScopes(composeSchemas().modules);
  return scopesOfElements;
}

/** The scopes whose receiver lambdas give elements, by class key. */
function elementScopes(modules: readonly SdkModuleSchema[]): Set<string> {
  const out = new Set<string>();

  for (const module of modules) {
    for (const f of module.functions ?? [])
      if (f.kotlin?.scope && addsContent(f, undefined)) out.add(f.kotlin.scope);

    for (const cls of module.types)
      if (cls.kind === "class" && cls.kotlin?.scope)
        for (const m of cls.methods ?? [])
          if (addsContent(m, cls)) out.add(`${module.module}.${cls.name}`);
  }

  return out;
}

/** Branded Kotlin numbers, by schema primitive: lucent:compose's own declarations declare them. */
const NUMBERS: Partial<Record<string, string>> = {
  float: "Float",
  int: "Int",
  long: "Long",
  short: "Short",
  byte: "Byte",
};

/** Which of overloads TypeScript cannot tell apart keeps the name: the widest numbers first. */
const NUMBER_RANK: Record<string, number> = {
  double: 0,
  long: 1,
  int: 2,
  float: 3,
  short: 4,
  byte: 5,
};

const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(
    " ",
  ),
);

class Missing extends Error {}

/** A class as lucent:compose declares it. */
interface Declared {
  module: SdkModuleSchema;
  cls: SdkClassSchema;
  /** Its TypeScript path, which its Kotlin one is too: `["Alignment", "Horizontal"]`. */
  path: string[];
  /** The import of its outermost class: `androidx.compose.ui.Alignment`. */
  import: string;
}

/** An interface, its members, and what inheriting its supertypes' overloads needs. */
interface Interface {
  decl: ts.Decl & { k: "interface" };
  /** The module of its class. */
  module: string;
  typeParams: readonly string[];
  /** Its supertypes' class keys and type arguments. */
  supers: { key: string; args: ts.Type[] }[];
  members: Entry[];
}

/** A container: the module, a namespace or an interface, by its path. */
interface Container {
  interfaces: Map<string, Interface>;
  functions: Map<string, Entry[]>;
  consts: Map<string, Entry[]>;
  namespaces: Map<string, Container>;
}

/** A declaration and the binding it stands for (none for interfaces and brands). */
interface Entry {
  decl: ts.Decl | ts.Member;
  binding?: ComposeBinding;
  /** For overloads TypeScript cannot tell apart. */
  erased?: string;
  rank?: number[];
}

const container = (): Container => ({
  interfaces: new Map(),
  functions: new Map(),
  consts: new Map(),
  namespaces: new Map(),
});

let generated: ComposeDeclarations | undefined;

/** lucent:compose's generated declarations (made once per process). */
export function composeDeclarations(): ComposeDeclarations {
  generated ??= generate(composeSchemas().modules);
  return generated;
}

/**
 * The declarations lucent:compose makes of one of Compose's modules (and
 * of the classes its extensions extend), as `lucent sdk show` prints them.
 */
export function composeModuleDts(module: string): string {
  return generate(composeSchemas().modules, module).text;
}

/** lucent:compose's text: its own declarations (`header`, lib/sdk/compose.d.ts), then Compose's. */
export function composeModuleText(header: string): string {
  return `${header}\n${composeDeclarations().text}`;
}

/**
 * Names lucent:compose's own declarations take (the content types, its
 * root view, the JSX namespace, Kotlin's numbers): Compose's of the same
 * name are not declared.
 */
const OWN = new Set([
  "ComposeView",
  "Composed",
  "Content",
  "ScopedContent",
  "ScopedChildren",
  "Shown",
  "JSX",
  "Float",
  "Int",
  "Long",
  "Short",
  "Byte",
]);

/** The declarations of `modules` (only those standing for `only`'s members, when given). */
function generate(modules: readonly SdkModuleSchema[], only?: string): ComposeDeclarations {
  // --- the classes, by schema reference ---

  const classes = new Map<string, Declared>();
  const companions = new Map<string, Declared>();
  const byTopName = new Map<string, string>();

  for (const module of [...modules].sort((a, b) => (a.module < b.module ? -1 : 1)))
    for (const cls of module.types) {
      if (cls.kind !== "class") continue;

      const names = cls.native.slice(cls.native.lastIndexOf("/") + 1).split("$");
      const key = `${module.module}.${cls.name}`;
      const declared: Declared = {
        module,
        cls,
        path: names,
        import: `${module.module}.${names[0]}`,
      };

      if (cls.kotlin?.kind === "companion") {
        companions.set(key, declared);
        continue;
      }

      if (OWN.has(names[0]!)) continue;

      // Two packages' classes of one name: the first package's.
      const taken = byTopName.get(names[0]!);
      if (taken && taken !== declared.import) continue;
      byTopName.set(names[0]!, declared.import);

      classes.set(key, declared);
    }

  const listScopes = elementScopes(modules);

  const types: TypeLookup = (module, name) => {
    const d = classes.get(`${module}.${name}`) ?? companions.get(`${module}.${name}`);
    return d && declarationFacts(d.cls, d.module);
  };

  // --- types ---

  const tsName = (d: Declared) => d.path.join(".");

  const tsType = (t: SdkType): ts.Type => {
    const base = ((): ts.Type => {
      switch (t.k) {
        case "prim":
          if (t.name === "void") return ts.keyword("void");
          if (t.name === "boolean") return ts.keyword("boolean");
          if (t.name === "double") return ts.keyword("number");
          if (NUMBERS[t.name]) return ts.ref(NUMBERS[t.name]!);
          throw new Missing(t.name);
        case "string":
          return ts.keyword("string");
        case "array":
          return ts.array(tsType(t.of));
        case "tparam":
          return ts.ref(t.name);
        case "fn":
          return ts.fn(
            t.params.map((p, i) => ts.param(`arg${i}`, tsType(p))),
            tsType(t.ret),
          );
        case "ref": {
          if (t.module === "kotlin" && t.name === "Any") return ts.keyword("unknown");

          const d = classes.get(`${t.module}.${t.name}`);
          if (!d) throw new Missing(`${t.module}.${t.name}`);

          return ts.ref(tsName(d), ...(t.args ?? []).map(tsType));
        }
        default:
          throw new Missing(t.k);
      }
    })();

    // Kotlin's `Any?` is any value: `unknown` holds null already.
    return t.nullable && !(base.k === "keyword" && base.name === "unknown")
      ? ts.union([base, ts.nullType])
      : base;
  };

  /**
   * A lambda's receiver, when it is a scope (a class only lambdas are
   * given: RowScope, LazyListScope): the lambda's first parameter.
   */
  const scopeOf = (k: SdkParam["kotlin"]): ts.Param[] => {
    const r = k?.receiver;
    const d = r?.k === "ref" ? classes.get(`${r.module}.${r.name}`) : undefined;

    return d?.cls.kotlin?.scope && !k?.returnsThrough ? [ts.param("scope", tsType(r!))] : [];
  };

  /**
   * An element's children: its content (a scope's may be a function of
   * it; content given more than its scope is one), or what a lambda of a
   * list's scope adds (a function of the scope).
   */
  const childrenType = (p: SdkParam): ts.Type => {
    const fn = p.type;
    if (fn.k !== "fn") throw new Missing("children");

    const scope = scopeOf(p.kotlin);
    const params = [...scope, ...fn.params.map((x, i) => ts.param(`arg${i}`, tsType(x)))];
    const nullable = (x: ts.Type) => (fn.nullable ? ts.union([x, ts.nullType]) : x);

    if (!params.length) return nullable(ts.ref("Shown"));
    if (params.length === 1 && scope.length && p.kotlin?.role === "content")
      return nullable(ts.ref("ScopedChildren", scope[0]!.type));

    return nullable(ts.fn(params, ts.ref("Shown")));
  };

  /** A parameter's type: content, a callback (a promise when it suspends), a value. */
  const paramType = (p: SdkParam): ts.Type => {
    const k = p.kotlin;
    const fn = p.type;
    if (fn.k !== "fn" || !k?.role) return tsType(p.type);

    const nullable = (x: ts.Type) => (fn.nullable ? ts.union([x, ts.nullType]) : x);
    const scope = scopeOf(k);
    const params = [...scope, ...fn.params.map((x, i) => ts.param(`arg${i}`, tsType(x)))];

    if (k.role === "content") {
      if (!params.length) return nullable(ts.ref("Content"));
      if (params.length === 1 && scope.length)
        return nullable(ts.ref("ScopedContent", scope[0]!.type));

      return nullable(ts.fn(params, ts.ref("Shown")));
    }

    let ret = tsType({ ...fn.ret, nullable: false });

    // What only the receiver makes: the function its member makes it from.
    if (k.returnsThrough && k.receiver?.k === "ref") {
      const receiver = classes.get(`${k.receiver.module}.${k.receiver.name}`);
      const maker = receiver?.cls.methods?.find((m) => m.name === k.returnsThrough);
      if (!maker) throw new Missing(k.returnsThrough);
      ret = tsType(maker.params[0]!.type);
    }

    if (k.suspendFunction) ret = ts.ref("Promise", ret);
    return nullable(ts.fn(params, ret));
  };

  // --- members ---

  /** Its plan's refusal, and the defaulted parameters (indexes) content cannot give. */
  const planOf = (
    module: SdkModuleSchema,
    owner: SdkClassSchema | undefined,
    member: ComposeMember,
  ): { refused?: string; dropped: Set<number> } => {
    const role = "returns" in member ? "call" : "type" in member ? "get" : "new";
    const plan = planBinding(owner, member, module, types, role);
    const refused = unsupportedReason(plan);
    const dropped = new Set<number>();

    plan.inputs.forEach((input, i) => {
      if (input.omissible && takenReason([input], 1)) dropped.add(i);
    });

    return refused ? { refused, dropped } : { dropped };
  };

  const safeName = (name: string) =>
    RESERVED.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name) ? `${name.replace(/\W/g, "_")}_` : name;

  /** A declaration's one-line documentation: what it is in Kotlin. */
  const docOf = (fqn: string, member: ComposeMember): string =>
    `Kotlin's ${fqn}${member.kotlin?.composable ? ": composable" : ""}${member.kotlin?.suspend ? ": suspends" : ""}.${member.deprecated ? " @deprecated" : ""}`;

  /**
   * A callable's TypeScript parameters and how they give its Kotlin ones
   * (`from` skips an extension's receiver).
   */
  const callForm = (
    member: SdkMethodSchema | SdkCallable,
    owner: SdkClassSchema | undefined,
    from: number,
    dropped: ReadonlySet<number>,
  ): { params: ts.Param[]; args: ComposeArg[] } => {
    const indices = member.params.map((_, i) => i).filter((i) => i >= from && !dropped.has(i));
    const p = (i: number) => member.params[i]!;
    // A value paired with its change callback takes a bound signal instead of both.
    const changes = new Set(
      member.params.flatMap((x) => (x.kotlin?.changedBy ? [x.kotlin.changedBy] : [])),
    );
    const optional = (i: number) => !!p(i).kotlin?.default;
    // Left out where a bound signal gives it: optional in TypeScript, not in the call's form.
    const omissible = (i: number) => optional(i) || changes.has(p(i).name);
    const typeOf = (i: number) => {
      const t = paramType(p(i));

      return p(i).kotlin?.changedBy ? ts.union([t, ts.ref("Bound", t)]) : t;
    };
    const named = (is: number[]): ts.Type =>
      ts.object(is.map((i) => ({ name: p(i).name, type: typeOf(i), optional: omissible(i) })));
    const positional = (i: number): ts.Param => ({
      name: safeName(p(i).name),
      type: typeOf(i),
      ...(omissible(i) ? { optional: true } : {}),
    });

    // An element: its named arguments are props, its trailing content its children.
    if ("returns" in member && isElement(member, owner)) {
      const last = indices.at(-1);
      const trailing =
        last !== undefined &&
        (p(last).kotlin?.role === "content" || givesElementsIn(listScopes, p(last)))
          ? last
          : undefined;
      const keyed = indices.filter((i) => i !== trailing);
      const members = keyed.map((i) => ({
        name: p(i).name,
        type: typeOf(i),
        optional: omissible(i),
      }));

      if (trailing !== undefined)
        members.push({
          name: "children",
          type: childrenType(p(trailing)),
          optional: optional(trailing),
        });

      if (!members.length) return { params: [], args: [] };

      return {
        params: [
          {
            name: "props",
            type: ts.object(members),
            ...(members.every((m) => m.optional) ? { optional: true } : {}),
          },
        ],
        args: [
          { k: "named", indices: keyed, ...(trailing !== undefined ? { children: trailing } : {}) },
        ],
      };
    }

    const defaulted = indices.filter(optional);
    const required = indices.filter((i) => !optional(i));

    // Every parameter defaulted: one options object.
    if (indices.length > 1 && !required.length)
      return {
        params: [{ name: "options", type: named(indices), optional: true }],
        args: [{ k: "named", indices }],
      };

    // Defaults after the last parameter without one: in order.
    const lastRequired = required.at(-1) ?? -1;
    if (defaulted.every((i) => i > lastRequired))
      return {
        params: indices.map(positional),
        args: indices.map((index) => ({ k: "param", index })),
      };

    // Else those without defaults, then the defaulted ones by name.
    return {
      params: [
        ...required.map(positional),
        { name: "options", type: named(defaulted), optional: true },
      ],
      args: [
        ...required.map((index): ComposeArg => ({ k: "param", index })),
        { k: "named", indices: defaulted },
      ],
    };
  };

  /** The erased shape of a TypeScript signature (brands are numbers) and its numbers' rank. */
  const erasure = (params: ts.Param[]) => ({
    erased: params
      .map(
        (x) =>
          `${x.optional ? "?" : ""}${ts.printType(x.type).replace(/\b(Float|Int|Long|Short|Byte)\b/g, "number")}`,
      )
      .join(","),
  });
  const rankOf = (member: SdkMethodSchema | SdkCallable) =>
    member.params.map((x) => (x.type.k === "prim" ? (NUMBER_RANK[x.type.name] ?? 0) : 0));

  // --- declarations ---

  const root = container();
  const at = (path: readonly string[]): Container => {
    let c = root;
    for (const name of path) {
      let next = c.namespaces.get(name);
      if (!next) c.namespaces.set(name, (next = container()));
      c = next;
    }
    return c;
  };
  const push = <K extends string>(map: Map<K, Entry[]>, name: K, entry: Entry) =>
    map.set(name, [...(map.get(name) ?? []), entry]);

  /** Interfaces by class key, with their supertypes (for the overloads they inherit). */
  const interfaces = new Map<string, Interface>();

  const interfaceOf = (d: Declared): Interface => {
    const home = at(d.path.slice(0, -1));
    const name = d.path.at(-1)!;
    let found = home.interfaces.get(name);

    if (!found) {
      const typeParams = d.cls.typeParams ?? [];
      const supers = (d.cls.implements ?? []).flatMap((s) => {
        const t = parseSdkType(s, "", typeParams);
        try {
          return t.k === "ref" ? [{ ref: t, type: tsType(t) }] : [];
        } catch (e) {
          if (e instanceof Missing) return [];
          throw e;
        }
      });

      found = {
        decl: {
          k: "interface",
          name,
          doc: `Kotlin's ${d.import}${d.path.length > 1 ? `.${d.path.slice(1).join(".")}` : ""}.`,
          ...(typeParams.length ? { typeParams: typeParams.map((n) => ({ name: n })) } : {}),
          ...(supers.length ? { extends: supers.map((x) => x.type) } : {}),
          members: [
            {
              k: "property",
              name: `lucent:compose.${tsName(d)}`,
              type: ts.literal(true),
              readonly: true,
            },
          ],
        },
        module: d.module.module,
        typeParams,
        supers: supers.map((x) => ({
          key: `${x.ref.module}.${x.ref.name}`,
          args: (x.ref.args ?? []).map(tsType),
        })),
        members: [],
      };
      home.interfaces.set(name, found);
      interfaces.set(`${d.module.module}.${d.cls.name}`, found);
    }

    return found;
  };

  const MODIFIER = "androidx.compose.ui.Modifier";

  /**
   * A scope's Modifier (`RowScope_Modifier`): Modifier, with the scope's
   * member extensions of it, which the scope's `Modifier` property starts
   * (`row.Modifier.weight(1)`); Kotlin writes `Modifier.weight(1f)` in the
   * scope's lambda.
   */
  const scopeModifierOf = (d: Declared): Interface | undefined => {
    const modifier = classes.get(MODIFIER);
    if (!modifier) return undefined;

    const home = at(d.path.slice(0, -1));
    const name = `${d.path.at(-1)!}_Modifier`;
    const found = home.interfaces.get(name);
    if (found) return found;

    const created: Interface = {
      decl: {
        k: "interface",
        name,
        doc: `Modifier in ${d.path.join(".")}'s lambdas, with its extensions of it.`,
        extends: [ts.ref(tsName(modifier))],
        members: [],
      },
      module: d.module.module,
      typeParams: [],
      supers: [{ key: `${modifier.module.module}.${modifier.cls.name}`, args: [] }],
      members: [],
    };
    home.interfaces.set(name, created);
    interfaces.set(`${d.module.module}.${d.cls.name}_Modifier`, created);

    // The scope's way to it: its `Modifier`, written as Kotlin's Modifier.
    interfaceOf(d).members.push({
      decl: { k: "property", name: "Modifier", type: ts.ref(name), readonly: true },
      binding: {
        module: d.module,
        owner: d.cls,
        member: {
          name: "Modifier",
          type: { k: "ref", module: "androidx.compose.ui", name: "Modifier", nullable: false },
          readonly: true,
        },
        write: { k: "top", name: "Modifier", imports: [modifier.import], property: true },
      },
    });

    return created;
  };

  /**
   * The overloads an interface's methods inherit: TypeScript takes an
   * interface's methods of a name as all of them, so a class declaring
   * one of an inherited name (RoundedCornerShape's createOutline) declares
   * its supertypes' again, their type parameters as its own arguments.
   */
  const inherit = (iface: Interface, declared: ReadonlyMap<Interface, readonly Entry[]>) => {
    const names = new Set(
      iface.members
        .filter((e) => e.decl.k === "method")
        .map((e) => (e.decl as { name: string }).name),
    );
    if (!names.size) return;

    const seen = new Set<Interface>();
    const visit = (of: Interface, map: ReadonlyMap<string, ts.Type>) => {
      for (const sup of of.supers) {
        const parent = interfaces.get(sup.key);
        if (!parent || seen.has(parent)) continue;
        seen.add(parent);

        const inner = new Map(
          parent.typeParams.map(
            (n, i) =>
              [n, sup.args[i] ? substitute(sup.args[i]!, map) : ts.keyword("unknown")] as const,
          ),
        );

        for (const e of declared.get(parent) ?? []) {
          const m = e.decl;
          if (m.k !== "method" || !names.has(m.name) || !e.binding) continue;

          const own = new Map([...inner].filter(([n]) => !m.typeParams?.some((p) => p.name === n)));
          iface.members.push({
            ...e,
            decl: {
              ...m,
              params: m.params.map((x) => ({ ...x, type: substitute(x.type, own) })),
              ret: substitute(m.ret, own),
            },
          });
        }

        visit(parent, inner);
      }
    };

    visit(iface, new Map());
  };

  /** A function of a container, and its binding. */
  const fnEntry = (
    home: Container,
    name: string,
    binding: Omit<ComposeBinding, "args">,
    typeParams: readonly string[],
    from: number,
    dropped: ReadonlySet<number>,
    ret: ts.Type,
    doc: string,
  ) => {
    const member = binding.member as SdkMethodSchema | SdkCallable;
    const { params, args } = callForm(member, binding.owner, from, dropped);
    const decl: ts.Decl = {
      k: "function",
      name,
      doc,
      ...(typeParams.length ? { typeParams: typeParams.map((n) => ({ name: n })) } : {}),
      params,
      ret,
    };
    push(home.functions, name, {
      decl,
      binding: { ...binding, args },
      ...erasure(params),
      rank: rankOf(member),
    });
  };

  const resultOf = (member: SdkMethodSchema, owner?: SdkClassSchema): ts.Type => {
    if (isElement(member, owner)) return ts.ref("Composed");

    const ret = tsType(member.returns);
    return member.kotlin?.suspend ? ts.ref("Promise", ret) : ret;
  };

  const attempt = (f: () => void) => {
    try {
      f();
    } catch (e) {
      if (!(e instanceof Missing)) throw e;
    }
  };

  // Classes: interfaces, constructors, statics.
  for (const d of classes.values()) {
    const { cls, module } = d;
    const ownerPath = d.path.join(".");
    const iface = interfaceOf(d);
    const own = cls.typeParams ?? [];

    for (const c of cls.constructors ?? [])
      attempt(() => {
        const plan = planOf(module, cls, c);
        if (plan.refused) return;

        fnEntry(
          at(d.path.slice(0, -1)),
          d.path.at(-1)!,
          {
            module,
            owner: cls,
            member: c,
            write: { k: "top", name: ownerPath, imports: [d.import] },
          },
          own,
          0,
          plan.dropped,
          ts.ref(tsName(d), ...own.map((n) => ts.ref(n))),
          `A new ${ownerPath} (its constructor).`,
        );
      });

    // A companion that is a value of its class: the class's name is that value.
    if (cls.kotlin?.companionValue)
      push(at(d.path.slice(0, -1)).consts, d.path.at(-1)!, {
        decl: {
          k: "const",
          name: d.path.at(-1)!,
          doc: `Kotlin's ${ownerPath}.`,
          type: ts.ref(tsName(d)),
        },
        binding: {
          module,
          owner: cls,
          member: {
            name: d.path.at(-1)!,
            type: { k: "ref", module: module.module, name: cls.name, nullable: false },
            readonly: true,
          },
          write: { k: "top", name: ownerPath, imports: [d.import], property: true },
        },
      });

    for (const m of cls.methods ?? [])
      attempt(() => {
        if (m.static && cls.kotlin?.companionValue) return;

        const plan = planOf(module, cls, m);
        if (plan.refused) return;

        const doc = docOf(`${ownerPath}.${m.name}`, m);
        if (m.static) {
          fnEntry(
            at(d.path),
            m.name,
            {
              module,
              owner: cls,
              member: m,
              write: { k: "static", name: m.name, owner: ownerPath, imports: [d.import] },
            },
            m.typeParams ?? [],
            0,
            plan.dropped,
            resultOf(m, cls),
            doc,
          );
          return;
        }

        // A scope's member extension of Modifier: a method of the scope's Modifier.
        if (m.kotlin?.extension) {
          const receiver = m.params[0]?.type;
          const target =
            receiver?.k === "ref" && `${receiver.module}.${receiver.name}` === MODIFIER
              ? scopeModifierOf(d)
              : undefined;
          if (!target) return;

          const form = callForm(m, cls, 1, plan.dropped);
          target.members.push({
            decl: {
              k: "method",
              name: m.name,
              ...(m.typeParams?.length
                ? { typeParams: m.typeParams.map((name) => ({ name })) }
                : {}),
              params: form.params,
              ret: ts.ref("this"),
              doc,
            },
            binding: {
              module,
              owner: cls,
              member: m,
              write: { k: "extension", name: m.name, imports: [] },
              args: form.args,
            },
            ...erasure(form.params),
            rank: rankOf(m),
          });
          return;
        }

        const { params, args } = callForm(m, cls, 0, plan.dropped);
        iface.members.push({
          decl: {
            k: "method",
            name: m.name,
            ...(m.typeParams?.length ? { typeParams: m.typeParams.map((name) => ({ name })) } : {}),
            params,
            ret: resultOf(m, cls),
            doc,
          },
          binding: {
            module,
            owner: cls,
            member: m,
            write: { k: "member", name: m.name, imports: [] },
            args,
          },
          ...erasure(params),
          rank: rankOf(m),
        });
      });

    for (const p of cls.properties ?? [])
      attempt(() => {
        if (p.static && cls.kotlin?.companionValue) return;
        if (planOf(module, cls, p).refused) return;

        const doc = docOf(`${ownerPath}.${p.name}`, p);
        if (p.static) {
          push(at(d.path).consts, p.name, {
            decl: { k: "const", name: p.name, doc, type: tsType(p.type) },
            binding: {
              module,
              owner: cls,
              member: p,
              write: {
                k: "static",
                name: p.name,
                owner: ownerPath,
                imports: [d.import],
                property: true,
              },
            },
          });
          return;
        }

        iface.members.push({
          decl: {
            k: "property",
            name: p.name,
            type: tsType(p.type),
            readonly: true,
            doc,
          },
          binding: {
            module,
            owner: cls,
            member: p,
            write: { k: "member", name: p.name, imports: [], property: true },
          },
        });
      });
  }

  // Top-level functions, extensions and constants.
  for (const module of modules) {
    for (const f of module.functions ?? [])
      attempt(() => {
        if (OWN.has(f.name)) return;

        const plan = planOf(module, undefined, f);
        if (plan.refused) return;

        const fqn = `${module.module}.${f.name}`;
        const doc = docOf(fqn, f);
        const property = f.kotlin?.property ? { property: true as const } : {};
        const receiver = f.kotlin?.extension ? f.params[0]!.type : undefined;

        if (!receiver) {
          fnEntry(
            root,
            f.name,
            { module, member: f, write: { k: "top", name: f.name, imports: [fqn] } },
            f.typeParams ?? [],
            0,
            plan.dropped,
            resultOf(f),
            doc,
          );
          return;
        }

        // An extension of a number, a boolean or a string: a function of its receiver.
        if (receiver.k === "prim" || receiver.k === "string") {
          fnEntry(
            root,
            f.name,
            {
              module,
              member: f,
              write: {
                k: "extension",
                name: f.name,
                imports: [fqn],
                receiverArg: true,
                ...property,
              },
            },
            f.typeParams ?? [],
            0,
            plan.dropped,
            resultOf(f),
            doc,
          );
          return;
        }

        if (receiver.k !== "ref") return;

        // An extension of a companion (`WindowInsets.Companion.systemBars`): a member of its class's namespace.
        const companion = companions.get(`${receiver.module}.${receiver.name}`);
        if (companion) {
          const owner = classes.get(
            `${companion.module.module}.${companion.path.slice(0, -1).join("_")}`,
          );
          if (!owner) return;

          const write: ComposeWrite = {
            k: "static",
            name: f.name,
            owner: owner.path.join("."),
            imports: [owner.import, fqn],
            ...property,
          };
          if (f.kotlin?.property)
            push(at(owner.path).consts, f.name, {
              decl: { k: "const", name: f.name, doc, type: resultOf(f) },
              binding: { module, member: f, write },
            });
          else
            fnEntry(
              at(owner.path),
              f.name,
              { module, member: f, write },
              f.typeParams ?? [],
              1,
              plan.dropped,
              resultOf(f),
              doc,
            );
          return;
        }

        // An extension of a class: a member of its interface (generic receivers: its `this` names them).
        const owner = classes.get(`${receiver.module}.${receiver.name}`);
        if (!owner) return;

        const iface = interfaceOf(owner);
        const write: ComposeWrite = { k: "extension", name: f.name, imports: [fqn], ...property };
        const self = receiver.args?.length
          ? [{ name: "this", type: tsType({ ...receiver, nullable: false }) } satisfies ts.Param]
          : [];

        if (f.kotlin?.property) {
          // A generic receiver's property would need a `this`: properties have none.
          if (!self.length)
            iface.members.push({
              decl: {
                k: "property",
                name: f.name,
                type: resultOf(f),
                readonly: true,
                doc,
              },
              binding: { module, member: f, write },
            });
          return;
        }

        const { params, args } = callForm(f, undefined, 1, plan.dropped);
        // A modifier's extension gives back the modifier: the same one's type, a scope's keeps its methods.
        const modifies =
          `${receiver.module}.${receiver.name}` === MODIFIER &&
          f.returns.k === "ref" &&
          `${f.returns.module}.${f.returns.name}` === MODIFIER;
        iface.members.push({
          decl: {
            k: "method",
            name: f.name,
            ...(f.typeParams?.length ? { typeParams: f.typeParams.map((name) => ({ name })) } : {}),
            params: [...self, ...params],
            ret: modifies ? ts.ref("this") : resultOf(f),
            doc,
          },
          binding: { module, member: f, write, args },
          ...erasure(params),
          rank: rankOf(f),
        });
      });

    for (const c of module.constants ?? [])
      attempt(() => {
        if (OWN.has(c.name) || planOf(module, undefined, c).refused) return;

        const fqn = `${module.module}.${c.name}`;
        push(root.consts, c.name, {
          decl: { k: "const", name: c.name, doc: docOf(fqn, c), type: tsType(c.type) },
          binding: {
            module,
            member: c,
            write: { k: "top", name: c.name, imports: [fqn], property: true },
          },
        });
      });
  }

  // --- printing, bindings in declaration order ---

  const bindings = new Map<string, ComposeBinding[]>();
  const register = (path: string, kind: DeclarationKind, name: string, b: ComposeBinding) => {
    const key = bindingKey(path, kind, name);
    bindings.set(key, [...(bindings.get(key) ?? []), b]);
  };

  // Inherited overloads, from the members each interface declares itself.
  const declared = new Map([...interfaces.values()].map((i) => [i, [...i.members]] as const));
  for (const iface of interfaces.values()) inherit(iface, declared);

  // One module's declarations: those of its members, renamed as in the whole.
  const shown = (e: Entry) => !only || e.binding?.module.module === only;

  const print = (c: Container, path: string[]): ts.Decl[] => {
    const out: ts.Decl[] = [];
    const names = [
      ...new Set([
        ...c.interfaces.keys(),
        ...c.functions.keys(),
        ...c.consts.keys(),
        ...c.namespaces.keys(),
      ]),
    ].sort();
    const here = path.join(".");

    for (const name of names) {
      const iface = c.interfaces.get(name);
      if (iface) {
        const members = distinct(
          iface.members,
          (e) => (e.decl as ts.Member & { name: string }).name,
        ).filter(shown);
        for (const e of members)
          register(
            [...path, name].join("."),
            e.decl.k === "method" ? "method" : "property",
            (e.decl as { name: string }).name,
            e.binding!,
          );
        if (!only || iface.module === only || members.length)
          out.push({
            ...iface.decl,
            members: [...iface.decl.members, ...members.map((e) => e.decl as ts.Member)],
          });
      }

      // A value (a companion) and functions of one name cannot both be: the value stays.
      const consts = c.consts.get(name) ?? [];
      const functions = consts.length ? [] : distinct(c.functions.get(name) ?? [], () => name);
      for (const e of [...consts.slice(0, 1), ...functions].filter(shown)) {
        const decl = e.decl as ts.Decl & { name: string };
        register(here, decl.k === "const" ? "const" : "function", decl.name, e.binding!);
        out.push(decl);
      }

      const ns = c.namespaces.get(name);
      const inner = ns && !consts.length ? print(ns, [...path, name]) : [];
      if (inner.length) out.push({ k: "namespace", name, decls: inner });
    }

    return out;
  };

  const text = ts.printUnit({ decls: print(root, []) });
  return { text, bindings };
}

/**
 * Overloads and members TypeScript can tell apart: of those with the same
 * erased signature the best-ranked keeps the name, and the others are
 * renamed after their numbers (`RoundedCornerShape_Float`); an interface's
 * property keeps its name over methods'.
 */
function distinct(entries: Entry[], nameOf: (e: Entry) => string): Entry[] {
  const out: Entry[] = [];
  const taken = new Map<string, Entry>();
  const properties = new Set(entries.filter((e) => e.decl.k === "property").map((e) => nameOf(e)));

  const sorted = [...entries].sort((a, b) => compareRank(a.rank ?? [], b.rank ?? []));

  for (const e of sorted) {
    if (e.decl.k === "property") {
      if (!taken.has(`property ${nameOf(e)}`)) {
        taken.set(`property ${nameOf(e)}`, e);
        out.push(e);
      }
      continue;
    }

    const name = (e.decl as { name: string }).name;
    if (properties.has(name)) continue;

    const key = `${name}(${e.erased})`;
    if (!taken.has(key)) {
      taken.set(key, e);
      out.push(e);
      continue;
    }

    // Renamed after its numbers' Kotlin types.
    const member = e.binding!.member as SdkMethodSchema;
    const suffix = member.params
      .filter((p) => p.type.k === "prim")
      .map((p) => NUMBERS[(p.type as { name: string }).name] ?? "Double")
      .join("_");
    const renamed = `${name}_${suffix || "2"}`;
    if (taken.has(`${renamed}(${e.erased})`)) continue;

    taken.set(`${renamed}(${e.erased})`, e);
    out.push({ ...e, decl: { ...e.decl, name: renamed } as typeof e.decl });
  }

  return out;
}

/** A type with type parameters (named in `map`) replaced by their arguments. */
function substitute(t: ts.Type, map: ReadonlyMap<string, ts.Type>): ts.Type {
  if (!map.size) return t;

  switch (t.k) {
    case "ref":
      return !t.args?.length && map.has(t.name)
        ? map.get(t.name)!
        : { ...t, ...(t.args ? { args: t.args.map((a) => substitute(a, map)) } : {}) };
    case "array":
      return { ...t, of: substitute(t.of, map) };
    case "union":
      return { ...t, members: t.members.map((m) => substitute(m, map)) };
    case "fn":
      return {
        ...t,
        params: t.params.map((p) => ({ ...p, type: substitute(p.type, map) })),
        ret: substitute(t.ret, map),
      };
    case "object":
      return { ...t, members: t.members.map((m) => ({ ...m, type: substitute(m.type, map) })) };
    default:
      return t;
  }
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
