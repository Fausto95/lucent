/**
 * Plans of members written out as Swift source (a `source` module's, see
 * swift-source.ts): nothing converts at run time, the body is Swift. A
 * value argument is written as it is, an action is a closure calling the
 * setup back, a builder a closure of the values it builds. What the call
 * form cannot write yet is refused here, by rule, with the reason coverage
 * counts and the body's diagnostic gives.
 */
import type {
  BindingPlan,
  ConversionPlan,
  Refusal,
  Role,
  TypeFacts,
  TypeLookup,
} from "./binding-plan.ts";
import { memberFacts } from "./facts.ts";
import {
  formatSchemaType,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
} from "./schema.ts";

type Member = SdkMethodSchema | SdkPropertySchema | SdkCallable;

/**
 * The rules, in the order they are checked: the first that refuses a
 * member names why. Each looks at the parameters as the call form gives
 * them, and the facts of the types they name.
 */
const RULES: readonly {
  rule: string;
  refuses: (params: readonly SdkParam[], types: TypeLookup) => string | undefined;
}[] = [
  {
    // A property wrapper's value (`Binding<Bool>`) is another view's state: a
    // Binding of a Bool, a String, a Double, or a type any of them may be,
    // is a setup signal (bind(signal)).
    rule: "property-wrapper",
    refuses: (params, types) => {
      const p = params.find((x) => wrapper(x.type, types) && !boundValue(x.type, types));
      return (
        p &&
        `\`${p.swift?.label ?? p.name}\` takes a ${shown(p.type)} (state the body shares): bind(signal) gives Bindings of a Bool, a String, a number, or a type any of them may be`
      );
    },
  },
  {
    // A builder's closure is written wherever Swift takes it (labeled, or
    // trailing): one that is given values (ForEach's items) is not yet.
    rule: "builder-arguments",
    refuses: (params) => {
      const p = params.find(
        (x) => x.swift?.kind === "builder" && x.type.k === "fn" && x.type.params.length,
      );
      return (
        p &&
        `\`${p.swift?.label ?? p.name}\` builds its content from values it is given: a body writes result builders that take none, for now`
      );
    },
  },
];

/** A type as a reason names it: `Binding of Color`, `FocusState.Binding`, `Date?`. */
function shown(t: SchemaType): string {
  const base =
    t.k === "ref"
      ? `${t.name.replaceAll("_", ".")}${t.args?.length === 1 ? ` of ${shown(t.args[0]!)}` : ""}`
      : t.k === "date"
        ? "Date"
        : t.k === "string"
          ? "String"
          : formatSchemaType({ ...t, nullable: false });

  return t.nullable ? `${base}?` : base;
}

/**
 * The value a Binding shares, when a body gives it as bind(signal): a
 * Bool, a String or a Double, which a setup signal holds as it is, or a
 * type parameter any of them may be (a Picker's `SelectionValue`), which
 * Swift infers from the signal's.
 */
export function boundValue(t: SchemaType, types: TypeLookup): SchemaType | undefined {
  if (t.k !== "ref" || t.name !== "Binding" || !wrapper(t, types) || t.args?.length !== 1)
    return undefined;

  const [value] = t.args;

  return value &&
    !value.nullable &&
    (value.k === "string" ||
      (value.k === "prim" && ["bool", "boolean", "double"].includes(value.name)) ||
      (value.k === "tparam" && !!value.bound))
    ? value
    : undefined;
}

/** Whether `t` is a property wrapper's value: a Binding, a State. */
function wrapper(t: SchemaType, types: TypeLookup): boolean {
  if (t.k !== "ref") return false;

  const facts: TypeFacts | undefined = types(t.module, t.name);
  return typeof facts?.swift === "object" && !!facts.swift.propertyWrapper;
}

/** How the body writes each parameter: nothing converts, what differs is what the source is. */
function input(p: SdkParam): ConversionPlan {
  const kind = p.swift?.kind ?? "value";
  const plan: ConversionPlan =
    kind === "value"
      ? { op: "passthrough", type: p.type }
      : { op: "callback", type: p.type, detail: kind };

  return p.defaulted === "optional" ? { ...plan, omissible: true } : plan;
}

/** The plan of a member of a `source` module (planBinding's, for those). */
export function planSource(
  owner: SdkClassSchema | undefined,
  member: Member,
  module: SdkModuleSchema,
  types: TypeLookup,
  role: Role,
): BindingPlan {
  const params = "params" in member ? member.params.filter((p) => p.defaulted !== "omitted") : [];
  const self: SchemaType | undefined = owner && {
    k: "ref",
    module: module.module,
    name: owner.name,
    nullable: false,
  };
  const out: SchemaType =
    "returns" in member
      ? member.returns
      : "type" in member
        ? member.type
        : (self ?? { k: "prim", name: "void", nullable: false });

  const plan: BindingPlan = {
    ...(member.symbol ? { symbol: member.symbol } : {}),
    display: `${owner?.name ?? module.module}.${"name" in member ? member.name : "init"}`,
    backend: "swift-source",
    role,
    ...(module.provenance ? { artifact: module.provenance.artifact } : {}),
    inputs: params.map(input),
    output: { op: "passthrough", type: out },
    facts: memberFacts(owner, member),
    requiredArtifacts: module.provenance ? [module.provenance.artifact] : [],
  };

  const isStatic = "static" in member && !!member.static;
  if (self && "name" in member && !isStatic) plan.receiver = { op: "passthrough", type: self };

  const refused = refusal(member, types, role);
  if (refused) plan.refused = refused;

  const since = member.since ?? owner?.since;
  if (since !== undefined) plan.availability = { platform: module.platform, since };

  return plan;
}

function refusal(member: Member, types: TypeLookup, role: Role): Refusal | undefined {
  if (role === "set" || role === "implement")
    return {
      rule: "role",
      reason: "a body writes values: it does not assign or implement members",
    };

  if (!("params" in member)) return undefined;

  for (const r of RULES) {
    const reason = r.refuses(member.params, types);
    if (reason) return { rule: r.rule, reason };
  }

  return undefined;
}
