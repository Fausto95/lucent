/**
 * A toolkit's module written from its schema: `lucent:swiftui`, from
 * SwiftUI written as source (bindgen's `sdkSourceModule`). The
 * declarations are the call form (bindgen's callForms): a type's
 * initializers are calls of its name (`Text("a")`), its statics and enum
 * cases values of it (`Color.green`, `Edge.Set.horizontal`), its instance
 * members methods (a protocol's too: View's modifiers), each overload one
 * form of one member.
 *
 * Each type is an interface, nominal through one brand keyed by a unique
 * symbol (it lists the type and every protocol it conforms to), and its
 * statics a value of the same name (`declare const Color: $Color`); a
 * nested type is reached through its parent (`Edge.Set`), and types Swift
 * keeps to itself (`_ShapeView`) are declared, not exported. Every
 * overload and value carries `@swift <symbol> [form]`, which leads the
 * code writing a body back to the member and the form. What the member's
 * plan refuses is declared with the reason, for the body's diagnostic.
 */
import {
  argumentsShape,
  boundValue,
  type CallForm,
  callForms,
  isScalarProtocol,
  jsxForm,
  ownTypes,
  planBinding,
  unsupportedReason,
} from "@lucent-lang/bindgen";
import { ts } from "@lucent-lang/codegen";
import { compareVersions } from "../package-versions.ts";
import type { Toolkit } from "../ui/toolkits.ts";
import { safeName } from "./dts.ts";
import { NATIVE_JSX_UI, nativeJsxDecls, nativeTags, rootViews } from "./native-jsx-dts.ts";
import { toolkitForms } from "./toolkit-forms.ts";
import {
  oldestIos,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SdkType,
} from "./schema.ts";

/** The JSDoc tag leading a declaration back to its member: `@swift <symbol> [form] [jsx]`. */
export const SOURCE_TAG = "swift";

/** Marks a view's JSX signature in its `@swift` tag: its form written as JSX (bindgen's jsxForm). */
export const JSX_FORM = "jsx";

/** The unique symbol every type's brand is keyed by. */
const BRAND = "toolkit";

/** What a builder makes: the toolkit's content type. */
const CONTENT = "Content";

/** The namespace typing the JSX of the toolkit's platform files. */
const JSX = "JSX";

/**
 * Standard Swift types a body writes in lucent:ui's forms, by name in
 * module `Swift`: the form's type there (a ClosedRange is `range(from, to)`).
 */
const UI_FORMS: Record<string, string> = { ClosedRange: "ClosedRange" };

/** lucent:ui's type of a Binding a setup signal gives: `bind(signal)`. */
const BOUND = "Bound";

type Member = SdkCallable | SdkMethodSchema | SdkPropertySchema;

/** One declaration of a member: a form of a call, or a value. */
interface Overload {
  name: string;
  /** Swift's type parameters a Lucent scalar may be (`V: Equatable`), one each. */
  typeParams: ts.TypeParam[];
  params: ts.Param[];
  ret: ts.Type;
  doc: string[];
  /** The member's call form and parameters, for a call (what its JSX and attribute forms follow). */
  call?: { form: CallForm; params: SdkParam[]; symbol: string; index: number; view: boolean };
  /**
   * Kept first: what the body may write, on every iOS the app runs on;
   * then those whose actions take more values (TypeScript types a
   * callback's parameters from the first overload it tries, and one
   * taking fewer values accepts it too); not deprecated, the oldest.
   */
  rank: [number, number, number, number, string];
}

/** What a type parameter bound to Lucent's scalars may be. */
const SCALAR = ts.union([ts.keyword("boolean"), ts.keyword("number"), ts.keyword("string")]);

/** `lucent:<toolkit>` for a toolkit whose declarations come from `schema`. */
export function toolkitDts(
  toolkit: Toolkit & { source: NonNullable<Toolkit["source"]> },
  schema: SdkModuleSchema,
): string {
  const types = new Map(
    schema.types.filter((t): t is SdkClassSchema => t.kind === "class").map((t) => [t.name, t]),
  );
  const fixed = [BRAND, CONTENT, BOUND, JSX, ...Object.values(UI_FORMS), toolkit.root];
  const taken = fixed.find((n) => types.has(n));
  if (taken)
    throw new Error(`${schema.module} declares ${taken}, a name its toolkit's module gives`);

  const own = (t: SdkType) =>
    t.k === "ref" && t.module === schema.module ? types.get(t.name) : undefined;
  const lookup = ownTypes(schema);
  // A view: the toolkit's view protocol, or a type conforming to it.
  const viewName = toolkit.source.view;
  const views = new Map<string, boolean>();
  const isView = (cls: SdkClassSchema): boolean => {
    const known = views.get(cls.name);
    if (known !== undefined) return known;

    views.set(cls.name, cls.name === viewName);
    const found =
      cls.name === viewName ||
      (cls.implements ?? []).some((r) => {
        const parent = types.get(r.slice(r.lastIndexOf(".") + 1));
        return !!parent && parent !== cls && isView(parent);
      });
    views.set(cls.name, found);
    return found;
  };
  const isViewRef = (t: SdkType): boolean => {
    const cls = own(t);
    return !!cls && isView(cls);
  };
  // The lucent:ui types the declarations name, which the module imports.
  const forms = new Set<string>();
  const uiForm = (t: SdkType) =>
    t.k === "ref" && t.module === "Swift" && t.args?.length === 1 ? UI_FORMS[t.name] : undefined;
  // A type parameter's name, unless the module's types or the toolkit's own take it.
  const typeParam = (name: string) => (types.has(name) || fixed.includes(name) ? `${name}_` : name);
  const known = (t: SdkType): boolean => {
    switch (t.k) {
      case "ref":
        if (uiForm(t)) return t.args!.every(known);

        return isScalarProtocol(t) || !!own(t);
      case "tparam":
        return !!t.bound && isScalarProtocol(t.bound);
      case "array":
        return known(t.of);
      case "fn":
        return t.params.every(known) && known(t.ret);
      default:
        return t.k === "prim" || t.k === "string";
    }
  };

  const value = (t: SdkType): ts.Type => {
    const base = ((): ts.Type => {
      switch (t.k) {
        case "prim":
          return ts.keyword(
            t.name === "void"
              ? "void"
              : t.name === "bool" || t.name === "boolean"
                ? "boolean"
                : "number",
          );
        case "string":
          return ts.keyword("string");
        case "array":
          return ts.readonlyArray(value(t.of));
        case "fn":
          return ts.fn(
            t.params.map((x, i) => ts.param(`arg${i}`, value(x))),
            ts.keyword("void"),
          );
        case "ref": {
          // A Binding a setup signal gives: lucent:ui's bind(signal).
          const bound = boundValue(t, lookup);

          if (bound) {
            forms.add(BOUND);
            return ts.ref(BOUND, value(bound));
          }

          const form = uiForm(t);

          if (form) {
            forms.add(form);
            return ts.ref(form, value(t.args![0]!));
          }

          return isScalarProtocol(t) ? SCALAR : ts.ref(t.name);
        }
        case "tparam":
          return ts.ref(typeParam(t.name));
        default:
          throw new Error(`${schema.module}: no declared type for ${t.k}`);
      }
    })();

    return t.nullable ? ts.union([base, ts.nullType]) : base;
  };

  const paramType = (p: SdkParam): ts.Type => {
    if (p.swift?.kind !== "builder" || p.type.k !== "fn") return value(p.type);

    const content = ts.ref(CONTENT);
    return p.type.params.length
      ? ts.fn(
          p.type.params.map((x, i) => ts.param(`arg${i}`, value(x))),
          content,
        )
      : content;
  };

  const overloads = (owner: SdkClassSchema | undefined, m: Member, name: string): Overload[] => {
    const refused = unsupportedReason(planBinding(owner, m, schema, ownTypes(schema)));
    const since = String(m.since ?? owner?.since ?? "0");
    const newer = compareVersions(since, oldestIos()) > 0;
    const doc = (form?: number) => [
      ...(refused ? [`Lucent cannot write this in a body yet: ${refused}.`] : []),
      ...(m.deprecated ? ["@deprecated"] : []),
      ...(m.since !== undefined ? [`@since iOS ${m.since}`] : []),
      `@${SOURCE_TAG} ${m.symbol ?? ""}${form === undefined ? "" : ` ${form}`}`.trimEnd(),
    ];
    const values = ("params" in m ? m.params : [])
      .filter((p) => p.swift?.kind === "action" && p.defaulted !== "omitted")
      .reduce((n, p) => n + (p.type.k === "fn" ? p.type.params.length : 0), 0);
    const rank: Overload["rank"] = [
      refused ? 1 : 0,
      newer ? 1 : 0,
      -values,
      m.deprecated ? 1 : 0,
      since,
    ];

    // A value has no type parameters: one of its type's is any value it may be.
    if ("type" in m) {
      if (!known(m.type)) return [];

      return [{ name, typeParams: [], params: [], ret: value(bounded(m.type)), doc: doc(), rank }];
    }

    const given = m.params.filter((p) => p.defaulted !== "omitted");
    const ret = "returns" in m ? m.returns : undefined;
    if (!given.every((p) => known(p.type)) || (ret && !known(ret))) return [];

    const typeParams = [
      ...new Set([...given.map((p) => p.type), ...(ret ? [ret] : [])].flatMap(typeParamsOf)),
    ].map((n): ts.TypeParam => ({ name: typeParam(n), extends: SCALAR }));

    return callForms(m.params).map((form, i) => ({
      name,
      typeParams,
      params: formParams(m.params, form, paramType),
      ret: ret ? value(ret) : owner ? ts.ref(owner.name) : ts.keyword("void"),
      doc: doc(i),
      call: {
        form,
        params: m.params,
        symbol: m.symbol ?? "",
        index: i,
        // What it makes (an initializer's type, a modifier's result) is a view.
        view: ret ? isViewRef(ret) : !!owner && isView(owner),
      },
      rank,
    }));
  };

  // Each type's own declarations, then what it inherits beside them.
  const declared = new Map<string, TypeDecls>();
  for (const cls of types.values()) declared.set(cls.name, typeDecls(cls, overloads));

  const ancestors = (cls: SdkClassSchema, seen = new Set<string>()): string[] => {
    for (const ref of cls.implements ?? []) {
      const name = ref.slice(ref.lastIndexOf(".") + 1);
      const parent = types.get(name);
      if (!parent || seen.has(name)) continue;

      seen.add(name);
      ancestors(parent, seen);
    }

    return [...seen].sort();
  };

  const methodsOf = (cls: SdkClassSchema): Overload[] => {
    const own = declared.get(cls.name)!;

    return inherit(
      own.methods,
      ancestors(cls).map((a) => declared.get(a)!.methods),
      own.properties,
    );
  };

  // A view's modifiers as attributes (`padding={8}`): an interface per view type
  // declaring any, over its bases' (those it declares again left out of them).
  const modifierDecls: ts.Decl[] = [];
  const modifiers = new Map<string, { ref?: ts.Type; names: ReadonlySet<string> }>();
  const modifiersOf = (cls: SdkClassSchema): { ref?: ts.Type; names: ReadonlySet<string> } => {
    const known = modifiers.get(cls.name);
    if (known) return known;

    const bases = (cls.implements ?? [])
      .map((r) => types.get(r.slice(r.lastIndexOf(".") + 1)))
      .filter((b): b is SdkClassSchema => !!b && b !== cls && isView(b))
      .map((b) => modifiersOf(b))
      .filter((b) => b.ref);
    const attributes = new Map<string, ts.Type[]>();
    for (const o of methodsOf(cls))
      if (o.call?.view)
        attributes.set(o.name, [...(attributes.get(o.name) ?? []), ...argumentValues(o)]);

    const names = new Set([...bases.flatMap((b) => [...b.names]), ...attributes.keys()]);
    const reuse = !attributes.size && bases.length === 1 && cls.name !== viewName;
    const found = reuse ? bases[0]! : { ref: ts.ref(`${cls.name}$Modifiers`), names };
    modifiers.set(cls.name, found);

    if (!reuse)
      modifierDecls.push({
        k: "interface",
        name: `${cls.name}$Modifiers`,
        local: true,
        ...(bases.length
          ? {
              extends: bases.map((b) =>
                omitted(
                  b.ref!,
                  [...attributes.keys()].filter((n) => b.names.has(n)),
                ),
              ),
            }
          : {}),
        members: [...attributes].map(([name, values]): ts.Member => ({
          k: "property",
          name,
          type: ts.union(values),
          optional: true,
        })),
      });

    return found;
  };

  /**
   * A modifier's arguments as an attribute's value, for each scalar its
   * type parameters may be: none (`true`), one value, or a tuple; trailing
   * optional arguments may be left out, down to one value or none.
   */
  const argumentValues = (o: Overload): ts.Type[] =>
    scalarChoices(o.typeParams).flatMap((choice) => {
      const params = o.params.map((p) => ({ ...p, type: substitute(p.type, choice) }));
      const required = params.findLastIndex((p) => !p.optional) + 1;
      const [first] = params;

      return [
        ...(argumentsShape(o.call!.form) === "tuple"
          ? [
              ts.tuple(
                params.map((p) => ({ type: p.type, ...(p.optional ? { optional: true } : {}) })),
              ),
            ]
          : []),
        ...(first && required <= 1 ? [first.type] : []),
        ...(required === 0 ? [ts.literal(true)] : []),
      ];
    });

  /** A view's JSX, per form of its initializer: its arguments as attributes and children. */
  const jsxSignatures = (cls: SdkClassSchema, inits: Overload[]): ts.Member[] => {
    const mods = modifiersOf(cls);
    const seen = new Set<string>();

    return inits.flatMap((o): ts.Member[] => {
      if (!o.call) return [];

      const { params, form } = o.call;
      const jsx = jsxForm(params, form);
      const fields = [
        ...jsx.attributes.map((a) => ({
          name: a.name,
          type: paramType(params[a.param]!),
          ...(a.optional ? { optional: true } : {}),
        })),
        ...(jsx.children
          ? [
              {
                name: "children",
                type:
                  jsx.children.kind === "text"
                    ? ts.keyword("string")
                    : paramType(params[jsx.children.param]!),
                ...(jsx.children.optional ? { optional: true } : {}),
              },
            ]
          : []),
      ];
      // A label wins over a modifier of its name, which stays a method for the chain.
      const clashes = jsx.attributes.map((a) => a.name).filter((n) => mods.names.has(n));
      const props = ts.intersection([
        ts.object(fields),
        ...(mods.ref ? [omitted(mods.ref, clashes)] : []),
      ]);
      const key = ts.printType(props);
      if (seen.has(key)) return [];

      seen.add(key);
      return [
        {
          k: "call",
          ...generic(o),
          params: [ts.param("props", props)],
          ret: o.ret,
          doc: docOf([...o.doc.slice(0, -1), `${o.doc.at(-1)!} ${JSX_FORM}`]),
        },
      ];
    });
  };

  const decls: ts.Decl[] = [
    { k: "const", name: BRAND, type: ts.keyword("unique symbol"), local: true },
    ...fixedDecls(toolkit),
  ];
  const namespaces: ts.Decl[] = [];

  for (const cls of types.values()) {
    const path = pathOf(cls);
    const hidden = path.some((p) => p.startsWith("_"));
    const own = declared.get(cls.name)!;
    const above = ancestors(cls);
    const methods = inherit(
      own.methods,
      above.map((a) => declared.get(a)!.methods),
      own.properties,
    );
    const nested = [...types.values()].filter((t) => {
      const p = pathOf(t);
      return p.length === path.length + 1 && p.slice(0, -1).join(".") === path.join(".");
    });
    const view = isView(cls);
    if (view) modifiersOf(cls);
    const statics = [
      ...(view ? jsxSignatures(cls, own.inits) : []),
      ...own.inits.map((o): ts.Member => ({
        k: "call",
        ...generic(o),
        params: o.params,
        ret: o.ret,
        doc: docOf(o.doc),
      })),
      ...own.staticProperties.map(property),
      ...own.staticMethods.map(method),
      ...nested
        .filter((t) => !pathOf(t).at(-1)!.startsWith("_") && hasStatics(declared.get(t.name)!))
        .map((t): ts.Member => ({
          k: "property",
          name: pathOf(t).at(-1)!,
          type: ts.ref(`$${t.name}`),
          readonly: true,
        })),
    ];

    decls.push({
      k: "interface",
      name: cls.name,
      ...(above.length
        ? {
            extends: above
              .filter((a) => (cls.implements ?? []).some((r) => r.endsWith(`.${a}`)))
              .map((a) => ts.ref(a)),
          }
        : {}),
      local: hidden || path.length > 1,
      members: [
        {
          k: "property",
          name: BRAND,
          computed: true,
          readonly: true,
          type: ts.object([cls.name, ...above].map((n) => ({ name: n, type: ts.literal(true) }))),
        },
        ...own.properties.map(property),
        ...methods.map(method),
      ],
    });

    const exported = path.length === 1 && !hidden;

    if (exported && nested.some((t) => !pathOf(t).at(-1)!.startsWith("_")))
      namespaces.push({ k: "namespace", name: cls.name, decls: typePaths(cls, types) });

    if (!statics.length) continue;

    decls.push({ k: "interface", name: `$${cls.name}`, local: true, members: statics });
    if (exported) decls.push({ k: "const", name: cls.name, type: ts.ref(`$${cls.name}`) });
  }

  for (const f of dedupe((schema.functions ?? []).flatMap((m) => overloads(undefined, m, m.name))))
    decls.push({
      k: "function",
      name: f.name,
      ...generic(f),
      params: f.params,
      ret: f.ret,
      doc: docOf(f.doc),
    });

  const text = ts.printUnit({
    banner: `Generated by Lucent from ${schema.provenance?.artifact ?? schema.module} (${schema.module}, written as source). Do not edit.`,
    decls: [
      {
        k: "importType" as const,
        names: [...new Set([...forms, ...NATIVE_JSX_UI])].sort(),
        from: "lucent:ui",
      },
      ...rootViews([toolkit.platform]).imports,
      ...decls,
      ...modifierDecls,
      ...namespaces,
      { k: "exportNothing" },
    ],
  });

  // Lucent's own forms (toolkit-forms.ts) go before the module's end.
  return text.replace(
    /export \{\};\n$/,
    `${toolkitForms(toolkit.source.module, (n) => types.has(n))}export {};\n`,
  );
}

/** A type's own declarations, by where they go. */
interface TypeDecls {
  inits: Overload[];
  properties: Overload[];
  methods: Overload[];
  staticProperties: Overload[];
  staticMethods: Overload[];
}

function typeDecls(
  cls: SdkClassSchema,
  overloads: (owner: SdkClassSchema, m: Member, name: string) => Overload[],
): TypeDecls {
  const of = <T extends Member>(
    list: T[] | undefined,
    name: (m: T) => string,
    keep: (m: T) => boolean,
  ) => dedupe((list ?? []).filter(keep).flatMap((m) => overloads(cls, m, name(m))));

  return {
    inits: of(
      cls.constructors,
      () => "",
      () => true,
    ),
    properties: of(
      cls.properties,
      (p) => p.name,
      (p) => !p.static,
    ),
    methods: of(
      cls.methods,
      (m) => m.name,
      (m) => !m.static,
    ),
    staticProperties: of(
      cls.properties,
      (p) => p.name,
      (p) => !!p.static,
    ),
    staticMethods: of(
      cls.methods,
      (m) => m.name,
      (m) => !!m.static,
    ),
  };
}

const hasStatics = (d: TypeDecls) =>
  !!(d.inits.length || d.staticProperties.length || d.staticMethods.length);

/** A type's Swift path in its module: `["Edge", "Set"]`. */
const pathOf = (cls: SdkClassSchema) => cls.native.split(".").slice(1);

/** The type names a namespace gives the types nested in `cls` (`Edge.Set` is Edge_Set). */
function typePaths(cls: SdkClassSchema, types: Map<string, SdkClassSchema>): ts.Decl[] {
  const path = pathOf(cls);

  return [...types.values()]
    .filter((t) => {
      const p = pathOf(t);
      return (
        p.length === path.length + 1 &&
        p.slice(0, -1).join(".") === path.join(".") &&
        !p.at(-1)!.startsWith("_")
      );
    })
    .flatMap((t): ts.Decl[] => {
      const name = pathOf(t).at(-1)!;
      const inner = typePaths(t, types);

      return [
        { k: "typeAlias", name, type: ts.ref(t.name) },
        ...(inner.length ? [{ k: "namespace" as const, name, decls: inner }] : []),
      ];
    });
}

/**
 * A type's methods: its own, with the inherited overloads of those it
 * declares again, or that more than one of its protocols declares
 * (TypeScript requires a type's method to take whatever each base's
 * takes). A name a type declares as a property is left to the property.
 */
function inherit(own: Overload[], bases: Overload[][], properties: Overload[]): Overload[] {
  const names = new Set(own.map((o) => o.name));
  const counts = new Map<string, number>();
  for (const base of bases)
    for (const name of new Set(base.map((o) => o.name)))
      counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, n] of counts) if (n > 1) names.add(name);

  const props = new Set(properties.map((p) => p.name));

  return dedupe([...own, ...bases.flat().filter((o) => names.has(o.name))]).filter(
    (o) => !props.has(o.name),
  );
}

/** Overloads in the order a call should meet them, each signature once. */
function dedupe(list: Overload[]): Overload[] {
  const seen = new Set<string>();
  const byRank = list
    .map((o, i) => ({ o, i }))
    .sort((a, b) => compareRank(a.o.rank, b.o.rank) || a.i - b.i)
    .map(({ o }) => o);

  return byRank.filter((o) => {
    // The types given, in order (labels are part of an object's type): names do not tell overloads apart.
    const key = `${o.name}(${o.params.map((p) => `${p.optional ? "?" : ""}${ts.printType(p.type)}`).join(", ")}): ${ts.printType(o.ret)}`;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function compareRank(a: Overload["rank"], b: Overload["rank"]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || compareVersions(a[4], b[4]);
}

/** `t` with each type parameter its bound. */
function bounded(t: SdkType): SdkType {
  switch (t.k) {
    case "tparam":
      return t.bound ? { ...t.bound, nullable: t.nullable } : t;
    case "array":
      return { ...t, of: bounded(t.of) };
    case "fn":
      return { ...t, params: t.params.map(bounded), ret: bounded(t.ret) };
    case "ref":
      return t.args ? { ...t, args: t.args.map(bounded) } : t;
    default:
      return t;
  }
}

/** The type parameters a type names (`(V, V) -> Void`: V), each once, in order. */
function typeParamsOf(t: SdkType): string[] {
  switch (t.k) {
    case "tparam":
      return [t.name];
    case "array":
      return typeParamsOf(t.of);
    case "fn":
      return [...t.params, t.ret].flatMap(typeParamsOf);
    case "ref":
      return (t.args ?? []).flatMap(typeParamsOf);
    default:
      return [];
  }
}

/** A form's parameters: its positional arguments, the labeled object, the trailing closure. */
function formParams(
  params: SdkParam[],
  form: CallForm,
  type: (p: SdkParam) => ts.Type,
): ts.Param[] {
  const used = new Set<string>();
  const named = (n: string) => {
    let name = safeName(n);
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    return name;
  };

  return form.parts.map((part): ts.Param => {
    const optional = part.optional ? { optional: true } : {};

    if (part.k !== "labeled") {
      const p = params[part.param]!;
      return { ...ts.param(named(p.name), type(p)), ...optional };
    }

    const fields = part.params.map((i) => {
      const p = params[i]!;
      return {
        name: p.swift!.label!,
        type: type(p),
        ...(p.defaulted === "optional" ? { optional: true } : {}),
      };
    });
    return { ...ts.param(named("labeled"), ts.object(fields)), ...optional };
  });
}

const property = (o: Overload): ts.Member => ({
  k: "property",
  name: o.name,
  type: o.ret,
  readonly: true,
  doc: docOf(o.doc),
});

/** An overload's type parameters, when it has any. */
const generic = (o: Overload) => (o.typeParams.length ? { typeParams: o.typeParams } : {});

const method = (o: Overload): ts.Member => ({
  k: "method",
  name: o.name,
  ...generic(o),
  params: o.params,
  ret: o.ret,
  doc: docOf(o.doc),
});

/**
 * The toolkit's own declarations: its root class, its body function (while
 * a body is still given to one), its content type and its JSX namespace.
 */
function fixedDecls(toolkit: Toolkit & { source: NonNullable<Toolkit["source"]> }): ts.Decl[] {
  const view = ts.ref(toolkit.source.view);
  // The platform's views are tags too (T48): an element is either, as the component returns it.
  const [root] = rootViews([toolkit.platform]).types as [ts.Type];
  const shown = ts.union([view, ts.literal(false), ts.nullType, ts.keyword("undefined")]);

  return [
    {
      k: "class",
      name: toolkit.root,
      doc: [
        `The controller hosting a ${toolkit.title} body: what a ${toolkit.title} component`,
        "returns, and its host shows.",
      ],
      members: [
        { k: "constructor", params: [], private: true },
        {
          k: "property",
          name: "toolkitRoot",
          type: ts.literal(true),
          readonly: true,
          private: true,
        },
      ],
    },
    {
      k: "typeAlias",
      name: CONTENT,
      // Views, or nothing where a condition leaves one out (`{shown && <Text>a</Text>}`).
      type: ts.union([shown, ts.readonlyArray(shown)]),
    },
    {
      k: "namespace",
      name: JSX,
      decls: [
        // What a JSX element is: a view, a body's (the program resolves each iOS file's JSX
        // here), or a platform view, as a component returns it.
        { k: "typeAlias", name: "Element", type: ts.intersection([view, root]) },
        {
          k: "typeAlias",
          name: "ElementType",
          type: ts.union([
            ts.fn([ts.param("props", ts.keyword("never"))], view),
            ...nativeTags([root]),
          ]),
        },
        ...nativeJsxDecls(),
        {
          k: "interface",
          name: "ElementChildrenAttribute",
          members: [{ k: "property", name: "children", type: ts.object([]) }],
        },
        { k: "interface", name: "IntrinsicElements", members: [] },
      ],
    },
  ];
}

/** A documentation comment on one line when it is one line. */
const docOf = (lines: string[]): ts.Doc => (lines.length === 1 ? lines[0]! : lines);

/** `Omit<type, names>`, or `type` when it leaves out none. */
function omitted(type: ts.Type, names: string[]): ts.Type {
  return names.length ? ts.ref("Omit", type, ts.union(names.map((n) => ts.literal(n)))) : type;
}

/** Each way to choose a scalar for every type parameter: one of Lucent's number, string, boolean. */
function scalarChoices(params: readonly ts.TypeParam[]): Map<string, ts.Type>[] {
  const scalars = [ts.keyword("boolean"), ts.keyword("number"), ts.keyword("string")];

  return params.reduce<Map<string, ts.Type>[]>(
    (choices, p) => choices.flatMap((c) => scalars.map((t) => new Map([...c, [p.name, t]]))),
    [new Map()],
  );
}

/** `t` with each type parameter `choice` names replaced by its choice. */
function substitute(t: ts.Type, choice: ReadonlyMap<string, ts.Type>): ts.Type {
  if (!choice.size) return t;

  const at = (x: ts.Type) => substitute(x, choice);

  switch (t.k) {
    case "ref":
      return choice.get(t.name) ?? (t.args ? ts.ref(t.name, ...t.args.map(at)) : t);
    case "array":
      return { ...t, of: at(t.of) };
    case "union":
      return ts.union(t.members.map(at));
    case "intersection":
      return ts.intersection(t.members.map(at));
    case "tuple":
      return { ...t, elements: t.elements.map((e) => ({ ...e, type: at(e.type) })) };
    case "fn":
      return ts.fn(
        t.params.map((p) => ({ ...p, type: at(p.type) })),
        at(t.ret),
      );
    case "object":
      return ts.object(t.members.map((m) => ({ ...m, type: at(m.type) })));
    default:
      return t;
  }
}
