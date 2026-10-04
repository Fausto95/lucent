/**
 * Binding plans: how one member of a schema is used, derived from the
 * schema by type and ABI rules. A plan names the backend, the role (a
 * call, a property's read or write, a construction, or a requirement a
 * Lucent class implements), one conversion per value crossing the
 * boundary, how failure is reported, the facts that hold and the
 * artifacts to link; what cannot cross carries the reason. The rules are
 * here once: the compiler refuses a use, documents a declaration and
 * emits the glue from the same plan, and coverage counts what it refuses.
 * Plans are derived data, never cached with the schema.
 */
import { memberFacts } from "./facts.ts";
import type { SdkLookup } from "./provider.ts";
import { planSource } from "./source-plan.ts";
import {
  type FactEvidence,
  formatSchemaType,
  type NativeFacts,
  type Platform,
  type PrimName,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkParam,
  type SdkModuleSchema,
  type SdkPropertySchema,
  type SwiftType,
  type SymbolId,
  type TypeParamBounds,
  type TypeParamUpperBounds,
} from "./schema.ts";

/**
 * How a use reaches the member: Objective-C messages, JNI, a generated
 * Swift or Kotlin shim, a C call; or (`kotlin-source`) generated Kotlin
 * source that calls it as Kotlin code would (a component's Compose
 * content), where values are Kotlin's own and cross nothing, or
 * (`swift-source`) Swift source a body is written in.
 */
export type Backend =
  | "objc"
  | "jni"
  | "swift-shim"
  | "kotlin-shim"
  | "c-abi"
  | "kotlin-source"
  | "swift-source";

/**
 * What a use does with a member: call it, construct its class, read or
 * write a property, or (a protocol or interface method) implement it in
 * a Lucent class that the platform then calls.
 */
export type Role = "call" | "new" | "get" | "set" | "implement";

/** Which way a value crosses: into native code (`in`), or out of it to Lucent code (`out`). */
export type Flow = "in" | "out";

export type ConversionOp =
  /** Numbers and booleans with the same representation on both sides. */
  | "passthrough"
  /** A JavaScript number to or from a native integer or float, `detail` naming the native type. */
  | "number"
  /**
   * A JavaScript bigint to or from a native 64-bit integer, `detail`
   * naming it: exactly, or RangeError when a bigint does not fit.
   */
  | "bigint"
  | "copy-string"
  | "copy-bytes"
  | "copy-array"
  | "copy-record"
  | "copy-set"
  /** A Swift tuple to or from a TypeScript one, element by element (`of`). */
  | "copy-tuple"
  | "copy-date"
  /** A native reference, retained by a NativeRef. */
  | "retain-object"
  /** A Swift value type, boxed. */
  | "box-swift-value"
  /** Wraps `of[0]`. */
  | "optional"
  /** A Swift enum with payloads. */
  | "tagged-union"
  /** A plain enum, as its integer or string. */
  | "enum"
  /** A C struct, by value. */
  | "struct"
  /** An Out<T> out-parameter. */
  | "out"
  /** A trampoline for a function-typed value; `detail` says when it runs. */
  | "callback"
  /** A native error to or from a Lucent Error. */
  | "error"
  /** Cannot cross: `reason` says why. */
  | "unsupported";

/**
 * When native code runs a Lucent function it was given: `sync` while it
 * waits for it (a result, a call it runs during, the main thread), holding
 * the Lucent lock; `queued` on the Lucent thread, later.
 */
export type Delivery = "sync" | "queued";

/** How a member reports failure: an NSError** it writes, Swift's `throws`, a pending Java exception. */
export type ErrorConvention = "nserror-out" | "swift-throws" | "java-exception";

export interface ConversionPlan {
  op: ConversionOp;
  type: SchemaType;
  of?: ConversionPlan[];
  detail?: string;
  /** Present exactly when `op` is `unsupported`: the precise, user-facing reason. */
  reason?: string;
  /**
   * A value a use may leave out: an argument with a default the call does
   * not give (the Swift shim leaves it out too), or one native code offers
   * a Lucent function (a block's parameter, a requirement's), which may
   * leave it out as JavaScript callbacks do. Its being unsupported refuses
   * only the uses that give or take it (`takenReason`).
   */
  omissible?: true;
  /** A callback native code runs: when (see Delivery). */
  delivery?: Delivery;
  /**
   * A constant group's 64-bit integer, which stays a number (see the prim
   * type's `group`): it crosses exactly, or throws RangeError (a number
   * holds integers exactly within +-(2^53 - 1) only).
   */
  exact?: true;
}

/** Why a member cannot be used in its role at all, and the general rule that says so. */
export interface Refusal {
  rule: string;
  reason: string;
}

export interface BindingPlan {
  symbol?: SymbolId;
  /** The member as printed, for messages: `UIDevice.batteryLevel`. */
  display: string;
  backend: Backend;
  role: Role;
  /** The artifact declaring the member (its module's), for explanations. */
  artifact?: string;
  /** The object an instance member is called on. */
  receiver?: ConversionPlan;
  /** What Lucent passes (a requirement Lucent implements: what the platform passes it). */
  inputs: ConversionPlan[];
  /** What Lucent gets back (a requirement Lucent implements: what it gives back). */
  output: ConversionPlan;
  /** How the member reports failure, when it can. */
  error?: ConversionPlan & { op: "error"; detail: ErrorConvention };
  /** Set when no use of the member in this role can work, whatever its values. */
  refused?: Refusal;
  /** A requirement a Lucent class implements: when the platform's call runs it. */
  delivery?: Delivery;
  facts: NativeFacts;
  availability?: { platform: Platform; since: number | string };
  /** The artifacts that must be linked: the member's, and those of the types it names. */
  requiredArtifacts: string[];
}

/**
 * What a plan needs to know of a type a member names. A lookup that
 * cannot tell leaves a fact out, and a rule that depends on it does not
 * refuse: unknown stays unknown. An absent `kind` is a declared type of
 * unknown kind.
 */
export interface TypeFacts {
  kind?: "class" | "protocol" | "enum" | "struct";
  /** An opaque CoreFoundation-style handle. */
  cf?: boolean;
  /** A Swift-only type: its Swift shape, or `true` when only that is known. */
  swift?: SwiftType | true;
  /** How many type parameters it declares. */
  typeParams?: number;
  /** The artifact declaring it. */
  artifact?: string;
}

/** The facts of `module.name`, or undefined when the declarations do not have it. */
export type TypeLookup = (module: string, name: string) => TypeFacts | undefined;

/** How a plan finds another module a member's types name (sdkModule, for a platform and options). */
export type ModuleLookup = (module: string) => SdkLookup;

type Member = SdkMethodSchema | SdkPropertySchema | SdkCallable;

type Declaration = SdkModuleSchema["types"][number];

/** The reason for a member that names a type the declarations do not have. */
export const undeclaredReason = (name: string) => `refers to ${name}, which is not declared`;

/**
 * The first type `t` names that is not declared (`Module.Name`), in the
 * order a reader meets them; `declared` says whether a reference with this
 * many type arguments is. The extractors leave out members naming one, for
 * this reason, and plans refuse them for the same.
 */
export function undeclaredType(
  t: SchemaType,
  declared: (ref: string, arity: number) => boolean,
): string | undefined {
  switch (t.k) {
    case "ref":
      if (!declared(`${t.module}.${t.name}`, t.args?.length ?? 0)) return `${t.module}.${t.name}`;
      return t.args?.map((a) => undeclaredType(a, declared)).find(Boolean);
    case "array":
    case "set":
    case "record":
    case "out":
      return undeclaredType(t.of, declared);
    case "fn":
      return [...t.params, t.ret].map((x) => undeclaredType(x, declared)).find(Boolean);
    case "tuple":
      return t.of.map((x) => undeclaredType(x, declared)).find(Boolean);
    default:
      return undefined;
  }
}

/** What a declaration tells a plan about its type. */
export function declarationFacts(decl: Declaration, schema: SdkModuleSchema): TypeFacts {
  const artifact = schema.provenance ? { artifact: schema.provenance.artifact } : {};

  if (decl.kind === "enum")
    return { kind: "enum", ...(decl.swift ? { swift: decl.swift } : {}), ...artifact };
  if (decl.kind === "struct") return { kind: "struct", ...artifact };

  return {
    kind: decl.interface ? "protocol" : "class",
    ...(decl.cf ? { cf: true } : {}),
    ...(decl.swift ? { swift: decl.swift } : {}),
    ...(decl.typeParams?.length ? { typeParams: decl.typeParams.length } : {}),
    ...artifact,
  };
}

/** Type facts from whole schemas: `module`'s own, and the others `lookup` finds. */
export function typesOf(module: SdkModuleSchema, lookup: ModuleLookup): TypeLookup {
  const schemas = new Map<string, SdkModuleSchema | undefined>([[module.module, module]]);

  return (name, type) => {
    if (!schemas.has(name)) {
      const found = lookup(name);
      schemas.set(name, "schema" in found ? found.schema : undefined);
    }

    const schema = schemas.get(name);
    const decl = schema?.types.find((x) => x.name === type);
    return decl && declarationFacts(decl, schema!);
  };
}

/**
 * Type facts from `module` alone: its own types, and every other module's
 * references taken as declared, of unknown kind (the extractors leave out
 * members that name a type nothing declares).
 */
export function ownTypes(module: SdkModuleSchema): TypeLookup {
  return (name, type) => {
    if (name !== module.module) return {};

    const decl = module.types.find((x) => x.name === type);
    return decl && declarationFacts(decl, module);
  };
}

/**
 * The native integers of 64 bits (Java's long, NSInteger and Swift's Int
 * on 64-bit iOS): more than a number holds exactly, so they are bigints.
 */
const WIDE_INTEGERS = new Set<string>(["long", "NSInteger", "NSUInteger", "int64", "uint64"]);

/** Whether a primitive type is a native 64-bit integer: a bigint in Lucent. */
export const isWideInteger = (name: string) => WIDE_INTEGERS.has(name);

/** Whether a native 64-bit integer is unsigned (NSUInteger, UInt64): 0 to 2^64 - 1. */
export const isUnsignedWide = (name: string) => name === "NSUInteger" || name === "uint64";

/** Whether values of a type are bigints in Lucent: 64-bit integers but a constant group's. */
export const isBigIntType = (t: SchemaType) => t.k === "prim" && isWideInteger(t.name) && !t.group;

/** Schema kinds with no Java type: JNI cannot pass them. A function is Kotlin's FunctionN. */
const NOT_JAVA = new Set<SchemaType["k"]>([
  "bytes",
  "date",
  "id",
  "record",
  "set",
  "tuple",
  "out",
  "error",
]);

/**
 * The numbers and booleans Swift shims pass, with their Swift and C types:
 * the only primitive values that cross to Swift.
 */
export const SWIFT_SCALARS: Partial<Record<PrimName, { swift: string; c: string }>> = {
  double: { swift: "Double", c: "double" },
  float: { swift: "Float", c: "float" },
  CGFloat: { swift: "CGFloat", c: "CGFloat" },
  NSInteger: { swift: "Int", c: "NSInteger" },
  NSUInteger: { swift: "UInt", c: "NSUInteger" },
  int8: { swift: "Int8", c: "int8_t" },
  uint8: { swift: "UInt8", c: "uint8_t" },
  int16: { swift: "Int16", c: "int16_t" },
  uint16: { swift: "UInt16", c: "uint16_t" },
  int32: { swift: "Int32", c: "int32_t" },
  uint32: { swift: "UInt32", c: "uint32_t" },
  int64: { swift: "Int64", c: "int64_t" },
  uint64: { swift: "UInt64", c: "uint64_t" },
  bool: { swift: "Bool", c: "bool" },
  boolean: { swift: "Bool", c: "bool" },
};

/** Where a value is, for the rules that depend on it. */
export interface Place {
  flow: Flow;
  /** A value the use passes itself (an argument, or the value it assigns): blocks are built only for these. */
  passed?: boolean;
  /** The result a use gets back (or, implemented, gives back). */
  result?: boolean;
  /** Inside an array, set or record. */
  element?: boolean;
  /** A type argument of a generic reference. */
  argument?: boolean;
  /** The object an instance member is called on. */
  receiver?: boolean;
  /** What an Out points to. */
  pointee?: boolean;
  /** Offered to a Lucent function as an argument, which it may leave out. */
  offered?: boolean;
  /** An argument with a default, which a call may leave out. */
  defaulted?: boolean;
  /** Offered while the platform waits for the function: pointers can be written back. */
  waits?: boolean;
  /** A function the platform waits for, whatever it returns (a Kotlin suspend function). */
  awaited?: boolean;
  /** A vararg parameter's values (Kotlin source), which a call may leave empty. */
  vararg?: boolean;
}

interface Context {
  backend: Backend;
  platform: Platform;
  role: Role;
  types: TypeLookup;
  /** Artifacts of the types met, for requiredArtifacts. */
  artifacts: Set<string>;
  /** Enums with payloads whose payloads were checked (an indirect enum holds itself). */
  checked: Set<string>;
}

/**
 * How `member` of `owner` (none for C and Swift functions and constants)
 * of `module` is used in `role` (by default: a constructor constructs, a
 * property is read, the rest is called). `lookup` finds the other modules
 * its types name.
 */
export function planMember(
  owner: SdkClassSchema | undefined,
  member: Member,
  module: SdkModuleSchema,
  lookup: ModuleLookup,
  role?: Role,
): BindingPlan {
  return planBinding(owner, member, module, typesOf(module, lookup), role);
}

/** planMember, with the facts of the types the member names from `types`. */
export function planBinding(
  owner: SdkClassSchema | undefined,
  member: Member,
  module: SdkModuleSchema,
  types: TypeLookup,
  role: Role = defaultRole(member),
): BindingPlan {
  if (module.form === "source" && module.platform === "ios")
    return planSource(owner, member, module, types, role);

  const backend = backendOf(owner, member, module);
  const ctx: Context = {
    backend,
    platform: module.platform,
    role,
    types,
    artifacts: new Set(module.provenance ? [module.provenance.artifact] : []),
    checked: new Set(),
  };
  const convert = (t: SchemaType, place: Place) => conversion(t, place, ctx);

  const plan: BindingPlan = {
    ...(member.symbol ? { symbol: member.symbol } : {}),
    display: `${owner?.name ?? module.module}.${displayName(member)}`,
    backend,
    role,
    ...(module.provenance ? { artifact: module.provenance.artifact } : {}),
    inputs: [],
    output: { op: "passthrough", type: VOID },
    facts: resultOwnership(owner, member, module, role, memberFacts(owner, member)),
    requiredArtifacts: [],
  };

  // The owner, with its own type parameters (`Box<Value>`).
  const args = owner?.typeParams?.map((name): SchemaType => ({
    k: "tparam",
    name,
    nullable: false,
  }));
  const self: SchemaType | undefined = owner
    ? {
        k: "ref",
        module: module.module,
        name: owner.name,
        nullable: false,
        ...(args ? { args } : {}),
      }
    : undefined;
  const isStatic = "static" in member && !!member.static;
  if (self && !isStatic && "name" in member && role !== "implement")
    plan.receiver = convert(self, { flow: "in", receiver: true });

  const params = "params" in member ? member.params.filter((p) => p.defaulted !== "omitted") : [];
  // An argument a call may leave out: a Swift default a shim leaves out, or a Kotlin one.
  const defaulted = (p: SdkParam) =>
    p.defaulted === "optional" ||
    // A vararg (Kotlin source) may be left empty.
    (backend === "kotlin-source"
      ? !!p.kotlin?.default || !!p.kotlin?.vararg
      : omitsKotlinDefault(owner, member, p));

  switch (role) {
    case "get":
      plan.output = convert(propertyOf(member, role).type, { flow: "out", result: true });
      break;

    case "set":
      plan.inputs = [convert(propertyOf(member, role).type, { flow: "in", passed: true })];
      break;

    case "call":
      plan.inputs = params.map((p) =>
        convert(p.type, {
          flow: "in",
          passed: true,
          defaulted: defaulted(p),
          ...(p.kotlin?.suspendFunction ? { awaited: true } : {}),
          ...(p.kotlin?.vararg ? { vararg: true } : {}),
        }),
      );
      plan.output = convert(methodOf(member, role).returns, { flow: "out", result: true });
      break;

    case "new":
      if (!self) throw new Error(`${plan.display}: a constructor needs its class`);

      plan.inputs = params.map((p) =>
        convert(p.type, {
          flow: "in",
          passed: true,
          defaulted: defaulted(p),
          ...(p.kotlin?.suspendFunction ? { awaited: true } : {}),
          ...(p.kotlin?.vararg ? { vararg: true } : {}),
        }),
      );
      plan.output = convert(self, { flow: "out", result: true });
      break;

    case "implement": {
      // A property requirement: its value given back, and set (when it can be) while Swift waits.
      if ("type" in member) {
        plan.delivery = "sync";
        plan.inputs = member.readonly ? [] : [convert(member.type, { flow: "out", waits: true })];
        plan.output = convert(member.type, { flow: "in", result: true });
        break;
      }

      const m = methodOf(member, role);
      const delivery = requirementDelivery(backend, owner, m);
      // Swift shims pass every argument; the others what the Lucent method takes.
      const offered = backend !== "swift-shim";

      plan.delivery = delivery;
      plan.inputs = params.map((p) =>
        convert(p.type, { flow: "out", offered, waits: delivery === "sync" }),
      );
      plan.output = convert(m.returns, { flow: "in", result: true });
      break;
    }
  }

  const refused = refusalOf(owner, member, backend, role);
  if (refused) plan.refused = refused;

  const error = errorConvention(member, backend, role);
  if (error) plan.error = { op: "error", type: ERROR, detail: error };

  const since = member.since ?? owner?.since;
  if (since !== undefined) plan.availability = { platform: module.platform, since };

  plan.requiredArtifacts = [...ctx.artifacts].sort();
  return plan;
}

/**
 * One value's conversion where `where` says, by the same rules as a
 * member's: for a use whose types a plan could not know (a generic member
 * specialized with the use's type arguments).
 */
export function planConversion(
  t: SchemaType,
  where: Place & { backend: Backend; platform: Platform; role?: Role },
  types: TypeLookup,
): ConversionPlan {
  const { backend, platform, role = "call", ...place } = where;
  const ctx: Context = { backend, platform, role, types, artifacts: new Set(), checked: new Set() };

  return conversion(t, place, ctx);
}

/**
 * Why no use of the plan's member can work: its refusal, else the first
 * unsupported conversion of the receiver, inputs and output. Omissible
 * values are left out: a use that does not give or take them works (see
 * takenReason).
 */
export function unsupportedReason(plan: BindingPlan): string | undefined {
  if (plan.refused) return plan.refused.reason;

  const first = (c: ConversionPlan): string | undefined =>
    c.omissible ? undefined : c.op === "unsupported" ? c.reason : c.of?.map(first).find(Boolean);

  return [...(plan.receiver ? [plan.receiver] : []), ...plan.inputs, plan.output]
    .map(first)
    .find(Boolean);
}

/**
 * Why a use giving or taking the first `taken` of `values` (a call's
 * arguments, a block's or a requirement's parameters) cannot.
 */
export function takenReason(values: ConversionPlan[], taken: number): string | undefined {
  const first = (c: ConversionPlan): string | undefined =>
    c.op === "unsupported" ? c.reason : c.of?.map(first).find(Boolean);

  return values.slice(0, taken).map(first).find(Boolean);
}

/**
 * A refused plan's explanation, for diagnostics: the member, why, and the
 * native declaration and artifact it comes from.
 */
export function explainRefusal(plan: BindingPlan): string | undefined {
  const reason = unsupportedReason(plan);
  if (!reason) return undefined;

  return `${plan.display}: ${reason}${provenanceOf(plan)}`;
}

/** ` (<symbol> in <artifact>)`, with what the plan knows of either. */
export function provenanceOf(plan: Pick<BindingPlan, "symbol" | "artifact">): string {
  if (plan.symbol && plan.artifact) return ` (${plan.symbol} in ${plan.artifact})`;
  if (plan.symbol) return ` (${plan.symbol})`;

  return plan.artifact ? ` (in ${plan.artifact})` : "";
}

const VOID: SchemaType = { k: "prim", name: "void", nullable: false };
const ERROR: SchemaType = { k: "error", nullable: false };

function defaultRole(member: Member): Role {
  if (!("name" in member)) return "new";

  return "type" in member ? "get" : "call";
}

function propertyOf(member: Member, role: Role): SdkPropertySchema {
  if (!("type" in member)) throw new Error(`a ${role} plan needs a property`);

  return member;
}

function methodOf(member: Member, role: Role): SdkMethodSchema {
  if (!("returns" in member)) throw new Error(`a ${role} plan needs a method or function`);

  return member;
}

function backendOf(
  owner: SdkClassSchema | undefined,
  member: Member,
  module: SdkModuleSchema,
): Backend {
  if (module.form === "source") return "kotlin-source";
  if (member.swift) return "swift-shim";
  if (module.platform === "android") return needsKotlinShim(member) ? "kotlin-shim" : "jni";

  const global = "global" in member && !!member.global;
  return !owner || owner.cf || global ? "c-abi" : "objc";
}

function displayName(member: Member): string {
  return "name" in member ? member.name : "constructor";
}

/**
 * What JNI cannot call as Kotlin declares it, which a generated Kotlin
 * shim calls: a suspend function, a value class the JVM passes unboxed, a
 * suspend function parameter.
 */
function needsKotlinShim(member: Member): boolean {
  const k = member.kotlin;
  return (
    !!k?.suspend ||
    !!k?.unboxed ||
    ("params" in member && member.params.some((p) => p.kotlin?.suspendFunction))
  );
}

/**
 * Whether a shim cannot write a member's type parameters: one is bounded
 * by what the schema keeps no Kotlin type of (a use-site projection).
 */
function bounded(owner: SdkClassSchema | undefined, member: Member): boolean {
  const unwritable = (
    facts: { bounds?: TypeParamBounds; upperBounds?: TypeParamUpperBounds } | undefined,
  ) =>
    Object.entries(facts?.bounds ?? {}).some(
      ([name, bound]) => bound === "other" && !facts?.upperBounds?.[name],
    );

  return unwritable(owner?.kotlin) || unwritable(member.kotlin);
}

/**
 * Whether a call may leave out a Kotlin parameter's default: a shim that
 * leaves it out calls the member, as Kotlin code would. JNI passes every
 * argument.
 */
export function omitsKotlinDefault(
  owner: SdkClassSchema | undefined,
  member: Member,
  param: SdkParam,
): boolean {
  return !!param.kotlin?.default && !bounded(owner, member);
}

/** What the Kotlin shims do not handle yet, as refusals, first match wins. */
const KOTLIN_SHIM_REFUSALS: [
  (owner: SdkClassSchema | undefined, member: Member, role: Role) => boolean,
  Refusal,
][] = [
  [
    (owner, member) => bounded(owner, member),
    {
      rule: "kotlin-shim-generic",
      reason:
        "generic Kotlin members bounded by a projected type (`T : List<out R>`) are not supported through a shim yet",
    },
  ],
  [
    (owner, _, role) => role === "implement" && !owner?.interface,
    {
      rule: "kotlin-shim",
      reason: "Lucent classes cannot override a Kotlin class's suspend or value-class members yet",
    },
  ],
];

/** The applier of UI: what a component's content composes into. */
const UI_APPLIER = "androidx.compose.ui.UiComposable";

const simpleName = (kotlinName: string) => kotlinName.slice(kotlinName.lastIndexOf("/") + 1);

/**
 * What generated Kotlin source does not call yet, as refusals, first match
 * wins: what content cannot write (an implementation, an assignment, a
 * reified type argument, arguments of a vararg), what it must not call (an
 * experimental or restricted API), what runs only where content cannot be
 * (a receiver scope, another applier's content), and a lambda whose result
 * only its receiver makes.
 */
const KOTLIN_SOURCE_REFUSALS: [
  (owner: SdkClassSchema | undefined, member: Member, role: Role) => string | undefined,
  string,
][] = [
  [
    (_, __, role) =>
      role === "implement"
        ? "Lucent classes cannot implement Kotlin interfaces of content yet"
        : undefined,
    "kotlin-source-implement",
  ],
  [
    (_, __, role) => (role === "set" ? "content does not assign Kotlin properties yet" : undefined),
    "kotlin-source-set",
  ],
  [
    (_, member) =>
      member.kotlin?.reified
        ? `a reified type parameter (${member.kotlin.reified.join(", ")}) is not supported yet`
        : undefined,
    "kotlin-reified",
  ],
  [
    (_, member) => {
      const markers = member.kotlin?.optIn;
      return markers
        ? `an experimental API: it needs opt-in to ${markers.map(simpleName).join(", ")}`
        : undefined;
    },
    "kotlin-opt-in",
  ],
  [
    (_, member) =>
      member.kotlin?.restricted ? "restricted to its own library group (@RestrictTo)" : undefined,
    "kotlin-restricted",
  ],
  // What runs in a lambda's receiver scope is called on the lambda's scope parameter.
  [
    (owner, member) =>
      owner && !owner.kotlin?.scope && !isStatic(member) && member.kotlin?.extension
        ? `an extension declared in ${owner.name}: it needs one as its receiver's scope, which content does not name yet`
        : undefined,
    "kotlin-member-extension",
  ],
  [
    (_, member) => {
      const applier = member.kotlin?.applier;
      return applier && applier !== UI_APPLIER && applier !== "*"
        ? `it composes ${applier.slice(applier.lastIndexOf(".") + 1)} content, not UI`
        : undefined;
    },
    "compose-applier",
  ],
  [
    (_, member) => {
      const receiver =
        member.kotlin?.extension && "params" in member ? member.params[0]?.type : undefined;
      return receiver && !["ref", "prim", "string"].includes(receiver.k)
        ? `an extension of ${formatSchemaType({ ...receiver, nullable: false })} is not supported yet`
        : undefined;
    },
    "kotlin-extension-receiver",
  ],
  [
    (_, member) =>
      member.kotlin?.varargShadowed
        ? "left empty, its vararg calls another overload: vararg values are not supported yet"
        : undefined,
    "kotlin-vararg",
  ],
  [
    (_, member) => {
      const made = ("params" in member ? member.params : []).find(
        (p) =>
          p.kotlin?.receiver &&
          !p.kotlin.returnsThrough &&
          p.type.k === "fn" &&
          !(p.type.ret.k === "prim" && p.type.ret.name === "void"),
      );
      return made ? `its lambda ${made.name} gives back what only its receiver makes` : undefined;
    },
    "kotlin-receiver-result",
  ],
];

const isStatic = (member: Member) => "static" in member && !!member.static;

/** A JVM name Java source can write: a Lucent class implementing the method overrides it in Java. */
const javaIdentifier = (name: string) => /^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u.test(name);

/** Member-level rules: what makes every use of a member in a role fail. */
function refusalOf(
  owner: SdkClassSchema | undefined,
  member: Member,
  backend: Backend,
  role: Role,
): Refusal | undefined {
  if (backend === "kotlin-shim")
    return KOTLIN_SHIM_REFUSALS.find(([applies]) => applies(owner, member, role))?.[1];

  if (backend === "kotlin-source")
    for (const [reason, rule] of KOTLIN_SOURCE_REFUSALS) {
      const found = reason(owner, member, role);
      if (found) return { rule, reason: found };
    }

  if (role === "set" && "type" in member) {
    if (member.readonly) return { rule: "read-only", reason: "it is read-only" };
    if (backend === "jni" && !member.setter)
      return { rule: "java-field-write", reason: "assigning Java fields is not supported yet" };
    if ((backend === "objc" || backend === "c-abi") && !member.setter)
      return { rule: "no-setter", reason: "it has no setter" };
  }

  // A class's override is Java source; an interface's implementation is a proxy, by any name.
  const jvmName = "java" in member ? member.java : undefined;
  if (
    backend === "jni" &&
    role === "implement" &&
    !owner?.interface &&
    jvmName &&
    !javaIdentifier(jvmName)
  )
    return {
      rule: "jvm-mangled-name",
      reason: `a method whose JVM name Java cannot write (${jvmName}) cannot be overridden`,
    };

  if (backend !== "swift-shim") return undefined;

  if (role === "new" && member.swift?.async)
    return { rule: "async-initializer", reason: "an async initializer cannot be a constructor" };

  if (role === "implement") {
    if ("static" in member && member.static)
      return {
        rule: "static-requirement",
        reason:
          "static requirements cannot be implemented by Lucent classes (Swift would call them without an object)",
      };

    // A getter Swift may wait for, or that throws, has no Lucent form.
    const s = member.swift!;
    return "type" in member && (s.async || s.throws)
      ? {
          rule: "requirement-effects",
          reason: "async or throwing property requirements cannot be implemented by Lucent classes",
        }
      : undefined;
  }

  return owner?.swift?.associatedTypes
    ? {
        rule: "associated-types",
        reason: "members of protocols with associated types cannot be called yet",
      }
    : undefined;
}

function errorConvention(
  member: Member,
  backend: Backend,
  role: Role,
): ErrorConvention | undefined {
  // A throwing Swift requirement throws what the Lucent method throws.
  if (role === "implement")
    return backend === "swift-shim" && member.swift?.throws ? "swift-throws" : undefined;
  if (backend === "kotlin-source") return undefined;
  if (backend === "jni" || backend === "kotlin-shim") return "java-exception";
  if (backend === "swift-shim") return member.swift?.throws ? "swift-throws" : undefined;

  return "throws" in member && member.throws ? "nserror-out" : undefined;
}

/**
 * When the platform's call of a requirement a Lucent class implements runs
 * it: now when the platform waits (it returns a value, or runs on the main
 * thread), else queued. JNI waits for results only.
 */
function requirementDelivery(
  backend: Backend,
  owner: SdkClassSchema | undefined,
  m: SdkMethodSchema,
): Delivery {
  const isVoid = m.returns.k === "prim" && m.returns.name === "void";
  if (backend === "jni") return isVoid ? "queued" : "sync";
  // An async requirement's result comes later: Swift never waits for the call.
  if (m.swift?.async) return "queued";
  // A throwing one's error comes back from the call.
  if (m.swift?.throws) return "sync";

  return !isVoid || owner?.mainActor || m.mainActor ? "sync" : "queued";
}

/**
 * Who owns what a call returns, when a general naming convention of the
 * platform says (ARC does not manage CoreFoundation values): Cocoa's
 * method families (alloc, new, copy, mutableCopy, create) and
 * CoreFoundation's Create/Copy rule for C functions give the caller the
 * result, and what the call writes through out-parameters.
 */
function resultOwnership(
  owner: SdkClassSchema | undefined,
  member: Member,
  module: SdkModuleSchema,
  role: Role,
  facts: NativeFacts,
): NativeFacts {
  if (module.platform !== "ios" || member.swift || role !== "call" || !("returns" in member))
    return facts;
  if (facts.ownership !== "unknown") return facts;

  const family = /^(alloc|new|copy|mutableCopy|create)(?![a-z])/;
  const rule = owner
    ? family.test(member.selector ?? member.name)
      ? "objc-method-family"
      : undefined
    : /Create|Copy/.test(member.name)
      ? "cf-create-rule"
      : undefined;
  if (!rule) return facts;

  const evidence: FactEvidence = { fact: "ownership", source: "convention", detail: rule };
  return { ...facts, ownership: "transferred", evidence: [...facts.evidence, evidence] };
}

/**
 * A value's conversion where `place` says: the rules first, then its
 * kind's conversion. An omissible value is marked once, outside its
 * optional wrapper (`inner`).
 */
function conversion(t: SchemaType, place: Place, ctx: Context, inner = false): ConversionPlan {
  const omissible =
    !inner && (place.offered || place.defaulted) ? { omissible: true as const } : {};

  if (ctx.backend === "jni" && NOT_JAVA.has(t.k))
    return { op: "unsupported", type: t, reason: `${t.k} values are not Java types`, ...omissible };

  const reason = rule(t, place, ctx);
  if (reason) return { op: "unsupported", type: t, reason, ...omissible };

  if (t.nullable) {
    const value = { ...t, nullable: false } as SchemaType;
    return {
      op: "optional",
      type: t,
      of: [conversion(value, place, ctx, true)],
      ...omissible,
    };
  }

  return { ...kindConversion(t, place, ctx), ...omissible };
}

/** A non-null value's conversion, by its schema type's kind. */
function kindConversion(t: SchemaType, place: Place, ctx: Context): ConversionPlan {
  const inner = (x: SchemaType, at: Omit<Place, "flow">) =>
    conversion(x, { flow: place.flow, ...at }, ctx);

  switch (t.k) {
    case "prim":
      if (t.name === "void" || t.name === "bool" || t.name === "boolean")
        return { op: "passthrough", type: t };

      if (isBigIntType(t)) return { op: "bigint", type: t, detail: t.name };

      return {
        op: "number",
        type: t,
        detail: t.name,
        ...(isWideInteger(t.name) ? { exact: true } : {}),
      };
    case "string":
      return withDetail(
        { op: "copy-string", type: t },
        t.charSequence ? "CharSequence" : t.cf ? "CFString" : undefined,
      );
    case "bytes":
      return withDetail({ op: "copy-bytes", type: t }, t.cf ? "CFData" : undefined);
    case "array":
      // Java's byte[] is a Uint8Array.
      if (t.of.k === "prim" && t.of.name === "byte" && !t.list)
        return { op: "copy-bytes", type: t, detail: "byte[]" };

      return withDetail(
        { op: "copy-array", type: t, of: [inner(t.of, { element: true })] },
        t.cf ? "CFArray" : t.list ? "List" : undefined,
      );
    case "set":
      return { op: "copy-set", type: t, of: [inner(t.of, { element: true })] };
    case "tuple":
      return { op: "copy-tuple", type: t, of: t.of.map((x) => inner(x, { element: true })) };
    case "record":
      return withDetail(
        { op: "copy-record", type: t, of: [inner(t.of, { element: true })] },
        t.cf ? "CFDictionary" : undefined,
      );
    case "date":
      return { op: "copy-date", type: t };
    case "id":
      return withDetail({ op: "retain-object", type: t }, t.cf ? "CFTypeRef" : "id");
    case "error":
      return { op: "error", type: t };
    case "out":
      return { op: "out", type: t, of: [inner(t.of, { pointee: true })] };
    case "classOf":
      return { op: "retain-object", type: t, detail: `Class<${t.param}>` };
    case "tparam":
      return { op: "retain-object", type: t, detail: `type parameter ${t.name}` };
    case "fn":
      return callbackConversion(t, place, ctx);
    case "ref": {
      // Kotlin's Any: whatever Kotlin value content passes.
      if (ctx.backend === "kotlin-source" && t.module === "kotlin" && t.name === "Any")
        return { op: "passthrough", type: t, detail: "Any" };

      const facts = declared(t, ctx);
      if (!facts)
        return { op: "unsupported", type: t, reason: undeclaredReason(`${t.module}.${t.name}`) };

      const of = t.args?.length ? { of: t.args.map((a) => inner(a, { argument: true })) } : {};
      return { op: declarationOp(facts), type: t, ...of };
    }
  }
}

/**
 * A function-typed value: native code calls the Lucent function it is
 * given (its parameters flow out to Lucent code, which may leave them out,
 * and its result back in), or Lucent code calls the block it got (the
 * other way round).
 */
function callbackConversion(
  t: SchemaType & { k: "fn" },
  place: Place,
  ctx: Context,
): ConversionPlan {
  const isVoid = t.ret.k === "prim" && t.ret.name === "void";
  const given = place.flow === "in";
  const delivery: Delivery | undefined = !given
    ? undefined
    : isVoid && t.escaping && !t.main && !place.awaited
      ? "queued"
      : "sync";
  const blocks = ctx.backend === "objc" || ctx.backend === "c-abi";
  const back: Flow = given ? "out" : "in";

  const params = t.params.map((p) =>
    conversion(
      p,
      { flow: back, offered: given && blocks, waits: delivery === "sync", passed: !given },
      ctx,
    ),
  );

  return {
    op: "callback",
    type: t,
    detail: `${t.escaping ? "escaping" : "during-call"}${t.main ? ", main thread" : ""}`,
    ...(delivery ? { delivery } : {}),
    of: [...params, conversion(t.ret, { flow: place.flow, result: true }, ctx)],
  };
}

/** A reference's type facts; undefined when it is not declared (on iOS, with its arity). */
function declared(t: SchemaType & { k: "ref" }, ctx: Context): TypeFacts | undefined {
  const facts = ctx.types(t.module, t.name);
  if (!facts) return undefined;

  // On iOS a reference gives a generic type all its arguments; Java's raw types give none.
  const arity = facts.typeParams ?? 0;
  if (ctx.platform === "ios" && facts.kind && (t.args?.length ?? 0) !== arity) return undefined;

  if (facts.artifact) ctx.artifacts.add(facts.artifact);
  return facts;
}

/** How a declared type crosses: enums and structs by value, Swift value types boxed, the rest retained. */
function declarationOp(facts: TypeFacts): ConversionOp {
  if (facts.kind === "enum") return "enum";
  if (facts.kind === "struct") return "struct";

  const swift = facts.swift === true ? undefined : facts.swift;
  if (swift?.cases) return "tagged-union";

  return swift?.kind === "struct" || swift?.kind === "enum" ? "box-swift-value" : "retain-object";
}

function withDetail(plan: ConversionPlan, detail: string | undefined): ConversionPlan {
  return detail ? { ...plan, detail } : plan;
}

// --- rules ---------------------------------------------------------------------------

/** Why a value of type `t` cannot cross where `place` says, on the context's backend. */
function rule(t: SchemaType, place: Place, ctx: Context): string | undefined {
  if (place.receiver || place.argument) return undefined;

  switch (ctx.backend) {
    case "kotlin-source":
      return kotlinSourceRule(t, place);
    case "jni":
    case "kotlin-shim":
      return jniRule(t, place, ctx);
    case "swift-shim":
      return swiftRule(t, place, ctx);
    default:
      return objcRule(t, place, ctx);
  }
}

/**
 * Generated Kotlin source: what content writes Kotlin for. Its callbacks
 * take no arguments yet, a Char has no Lucent value, and a vararg's values
 * are not given (a call leaves it empty).
 */
function kotlinSourceRule(t: SchemaType, place: Place): string | undefined {
  if (place.vararg) return "values of a vararg parameter are not supported yet";
  if (t.k === "prim" && t.name === "char") return "Kotlin's Char has no Lucent type in content yet";

  return undefined;
}

/**
 * JNI: arrays and lists copy element by element, except into an array of
 * a type parameter's values (its Java class depends on the values; a
 * list's does not); and what a Lucent function implementing a Java method
 * takes and gives back (boxed arguments and results).
 */
function jniRule(t: SchemaType, place: Place, ctx: Context): string | undefined {
  if (t.k === "array" && !t.list && t.of.k === "tparam" && place.flow === "in")
    return "arrays of a type parameter's values cannot be passed to Java yet";

  // A Kotlin function's arguments and result cross boxed, one by one: not functions.
  if (ctx.backend === "jni" && t.k === "fn" && [...t.params, t.ret].some((x) => x.k === "fn"))
    return "Kotlin functions taking or giving functions are not supported yet";

  if (ctx.role !== "implement") return undefined;

  if (place.offered && t.k === "prim" && t.name === "char")
    return "a char argument is not supported yet";
  if (place.result && !["prim", "string", "tparam", "ref"].includes(t.k))
    return `Lucent functions cannot return a ${formatSchemaType({ ...t, nullable: false })} to Java yet`;

  return undefined;
}

/**
 * Objective-C and C: what the glue converts each way. Collections hold
 * plain values; errors do not go in, and blocks go in only as arguments;
 * a block read from native code takes no blocks; a pointer a Lucent
 * function receives is written back only while the platform waits, and
 * only to a number or an enum.
 */
function objcRule(t: SchemaType, place: Place, ctx: Context): string | undefined {
  if (place.pointee) return undefined;

  const k = t.k;
  const unconverted = k === "fn" || k === "out" || k === "error" || k === "classOf";

  if (place.element) {
    if (place.flow === "in")
      return unconverted ? `${k} elements cannot be passed to Objective-C yet` : undefined;
    if (k === "array" || k === "set" || k === "record")
      return "nested collections from Objective-C are not supported yet";

    return unconverted ? `${k} elements from Objective-C are not supported yet` : undefined;
  }

  if (place.flow === "in") {
    if (k === "error") return "passing errors to Objective-C is not supported yet";
    if (k !== "fn") return undefined;
    if (!place.passed) return "blocks can only be passed to Objective-C as arguments yet";

    return t.params.some((p) => p.k === "fn" && p.params.some((q) => q.k === "fn"))
      ? "blocks that take blocks that take blocks are not supported"
      : undefined;
  }

  if (k === "fn" && t.params.some((p) => p.k === "fn"))
    return "blocks that take blocks cannot be called from Lucent yet";

  if (k === "out" && place.offered) {
    if (!place.waits)
      return "a block or requirement that takes a pointer must run while the platform waits for it";

    // A type of unknown kind may be an enum: nothing proves otherwise.
    const of = t.of;
    const kind = of.k === "ref" ? ctx.types(of.module, of.name)?.kind : undefined;
    const value = of.k === "prim" || (of.k === "ref" && (kind === "enum" || kind === undefined));
    return value
      ? undefined
      : "a pointer to a struct or an object passed to Lucent code is not supported yet";
  }

  if (k === "out" || k === "classOf") return `Objective-C ${k} values cannot be read here yet`;
  return undefined;
}

/**
 * Swift shims: scalars, enums as their case index, and objects (C structs
 * as their bytes, enums with payloads as their case's dictionary). What
 * would need a Swift optional of a scalar, or a closure, does not cross yet.
 */
function swiftRule(t: SchemaType, place: Place, ctx: Context): string | undefined {
  const not = (what: string) => `${what} cannot cross to Swift yet`;
  const optionalUnion = "optional Swift enums with payloads cannot cross to Swift yet";

  switch (t.k) {
    case "prim":
      if (t.name === "void") return place.result ? undefined : not("void values");
      if (!SWIFT_SCALARS[t.name]) return not(`${t.name} values`);

      return t.nullable ? not("optional numbers and booleans") : undefined;

    case "string":
    case "bytes":
    case "date":
    case "id":
    // Specialized with the use's type arguments, which planConversion judges.
    case "tparam":
      return undefined;

    case "tuple":
      if (t.of.some((x) => x.nullable)) return not("tuples of optional values");
      if (t.of.some((x) => isStruct(x, ctx))) return not("tuples of C structs");

      return t.nullable ? not("optional tuples") : undefined;

    case "array":
    case "record":
      if (t.of.nullable) return not("collections of optional values");
      if (isStruct(t.of, ctx)) return not("collections of C structs");

      return place.flow === "in" && !place.element && t.nullable && hasUnion(t, ctx)
        ? optionalUnion
        : undefined;

    case "ref": {
      const facts = ctx.types(t.module, t.name);
      if (facts?.kind === "enum") {
        if (!facts.swift) return not(`Objective-C enums (${t.name})`);
        return t.nullable ? not("optional Swift enums") : undefined;
      }
      if (facts?.kind === "struct")
        return t.nullable ? not(`optional C structs (${t.name})`) : undefined;

      const swift = facts?.swift === true ? undefined : facts?.swift;
      if (swift?.associatedTypes) return openedRule(t, swift, facts?.typeParams ?? 0, place, not);
      if (!swift?.cases) return undefined;

      const payload = payloadRule(t, swift.cases, place, ctx);
      if (payload) return payload;

      return place.flow === "in" && !place.element && t.nullable ? optionalUnion : undefined;
    }

    default:
      return not(`${t.k} values`);
  }
}

/**
 * A value of a protocol with associated types or `Self` requirements
 * (`some Store<String>`): Swift opens one it is given, so it crosses as an
 * argument whose associated types it names; a result would have no type
 * to hold it.
 */
function openedRule(
  t: SchemaType & { k: "ref" },
  swift: SwiftType,
  arity: number,
  place: Place,
  not: (what: string) => string,
): string | undefined {
  if (place.flow !== "in" || !place.passed || place.element)
    return not(
      `${t.name} values other than arguments (a protocol with associated types or Self requirements)`,
    );

  const named = swift.primaryAssociatedTypes?.length ?? 0;
  return named === arity && (t.args?.length ?? 0) === arity
    ? undefined
    : not(`${t.name} values whose associated types the argument does not name`);
}

/** A payload crosses as an object's field: optional scalars and C structs do not yet. */
function payloadRule(
  t: SchemaType & { k: "ref" },
  cases: NonNullable<SwiftType["cases"]>,
  place: Place,
  ctx: Context,
): string | undefined {
  const key = `${t.module}.${t.name}`;
  if (ctx.checked.has(key)) return undefined;
  ctx.checked.add(key);

  for (const c of cases)
    for (const p of c.params) {
      const reason = swiftRule(p.type, { flow: place.flow, element: true }, ctx);
      if (reason) return reason;

      const scalar = isScalar(p.type, ctx);
      if (scalar ? p.type.nullable : isStruct(p.type, ctx))
        return `optional numbers and enums, and C structs, in payloads (${t.name}.${c.name}) cannot cross to Swift yet`;
    }

  return undefined;
}

/** A number, a boolean or an enum without payloads: what a shim passes by value. */
function isScalar(t: SchemaType, ctx: Context): boolean {
  return t.k === "prim" || (t.k === "ref" && ctx.types(t.module, t.name)?.kind === "enum");
}

function isStruct(t: SchemaType, ctx: Context): boolean {
  return t.k === "ref" && ctx.types(t.module, t.name)?.kind === "struct";
}

/** Whether a type is, or holds, a Swift enum with payloads. */
function hasUnion(t: SchemaType, ctx: Context): boolean {
  if (t.k === "array" || t.k === "record") return hasUnion(t.of, ctx);
  if (t.k !== "ref") return false;

  const swift = ctx.types(t.module, t.name)?.swift;
  return swift !== undefined && swift !== true && !!swift.cases;
}
