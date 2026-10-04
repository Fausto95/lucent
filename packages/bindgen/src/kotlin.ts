/**
 * The Kotlin side of Android extraction: the metadata of a classpath's
 * class files (read with the class files, decoded on first use), and each
 * class's Kotlin view — the source declaration behind each of its JVM
 * methods — which android.ts types members from.
 */
import type {
  KotlinClass,
  KotlinConstructor,
  KotlinDeclaration,
  KotlinFunction,
  KotlinProperty,
  KotlinType,
  KotlinTypeParameter,
} from "./kotlin-metadata.ts";
import { jvmMemberRoles } from "./kotlin-metadata.ts";
import {
  kotlinDeclaration,
  type MetadataHeader,
  readMetadataHeader,
} from "./kotlin-metadata-reader.ts";
import type {
  KotlinClassFacts,
  KotlinMemberFacts,
  KotlinParamFacts,
  KotlinTypeRef,
  TypeParamBounds,
  TypeParamUpperBounds,
} from "./schema.ts";

/** A class file's decoded metadata: its declaration (undefined when not API), or why it was not read. */
type Decoded = { declaration: KotlinDeclaration | undefined } | { unread: string };

/** The Kotlin metadata of a classpath, by class internal name. */
export interface KotlinClasses {
  headers: Map<string, MetadataHeader>;
  decoded: Map<string, Decoded>;
}

const METADATA = Buffer.from("Lkotlin/Metadata;");

/** An empty index, filled by `addKotlinClass`. */
export function kotlinClasses(): KotlinClasses {
  return { headers: new Map(), decoded: new Map() };
}

/** Reads a class file's `@kotlin.Metadata` header, if it has one; the protobuf waits for first use. */
export function addKotlinClass(k: KotlinClasses, internal: string, bytes: Buffer): void {
  if (!bytes.includes(METADATA)) return;

  const header = readMetadataHeader(bytes);
  if (header) k.headers.set(internal, header);
}

/** A class's metadata, decoded once; undefined for a class without any (Java). */
function decoded(k: KotlinClasses, internal: string): Decoded | undefined {
  const header = k.headers.get(internal);
  if (!header) return undefined;

  let d = k.decoded.get(internal);
  if (!d) {
    try {
      d = { declaration: kotlinDeclaration(header) };
    } catch (e) {
      // The reader names the class first; the schema names it itself.
      d = { unread: (e as Error).message.replace(`${internal}: `, "") };
    }
    k.decoded.set(internal, d);
  }

  return d;
}

/**
 * Whether Kotlin callers see a class Java sees: not compiler plumbing
 * (`$DefaultImpls`, multi-file parts), internal or private. A class whose
 * metadata cannot be read is taken as Java sees it.
 */
export function kotlinApi(k: KotlinClasses, internal: string): boolean {
  const header = k.headers.get(internal);
  if (!header) return true;
  if (header.kind === 3 || header.kind === 5) return false;
  if (header.kind !== 1) return true;

  const d = decoded(k, internal)!;
  return "unread" in d || d.declaration !== undefined;
}

/** A JVM method's source declaration. */
export type KotlinMember =
  /** `outer`: the type parameters of the class declaring it, which its own bounds may name. */
  | { role: "function"; function: KotlinFunction; outer: readonly KotlinTypeParameter[] }
  | { role: "constructor"; constructor: KotlinConstructor }
  | { role: "getter" | "setter"; property: KotlinProperty };

/** A class as Kotlin declares it, for its JVM members. */
export interface KotlinView {
  facts: Omit<KotlinClassFacts, "sealed" | "value"> & {
    /** Kotlin names of the direct subclasses. */
    sealed?: string[];
    value?: { property: string; type: KotlinType };
  };
  /** The JVM methods the metadata names (`name` + descriptor), with their declarations. */
  members: Map<string, KotlinMember>;
  /** Properties that are not extensions: the class's own, read through accessors or fields. */
  properties: KotlinProperty[];
  /**
   * JVM methods Kotlin generates for Java callers beside its declarations,
   * which the metadata does not name: the statics of a companion's
   * `@JvmStatic` members (`name` + descriptor), and the names of
   * declarations with defaults (`@JvmOverloads` overloads, the no-argument
   * constructor).
   */
  bridges: Set<string>;
  overloaded: Set<string>;
  /** Static fields Kotlin never leaves null: enum entries, an object's `INSTANCE`, the companion. */
  nonNullFields: Set<string>;
}

/**
 * A class's Kotlin view; undefined for a Java class or one without
 * declarations of its own (a synthetic class), `unread` when its metadata
 * cannot be read.
 */
export function kotlinView(
  k: KotlinClasses,
  internal: string,
): KotlinView | { unread: string } | undefined {
  const d = decoded(k, internal);
  if (!d) return undefined;
  if ("unread" in d) return d;

  const declaration = d.declaration;
  if (!declaration) return undefined;

  switch (declaration.metadataKind) {
    case "class":
      return classView(k, internal, declaration);
    case "file-facade":
      return membersView({ kind: "file-facade" }, [declaration]);
    case "multi-file-facade": {
      const parts = declaration.parts.map((p) => decoded(k, p));
      const unread = parts.find((p) => p && "unread" in p);
      if (unread) return unread as { unread: string };

      return membersView(
        { kind: "multi-file-facade" },
        parts.flatMap((p) =>
          p && "declaration" in p && p.declaration?.metadataKind === "multi-file-part"
            ? [p.declaration]
            : [],
        ),
      );
    }
    default:
      return undefined;
  }
}

const CLASS_KINDS: Record<KotlinClass["kind"], KotlinClassFacts["kind"]> = {
  class: "class",
  interface: "interface",
  enum: "enum",
  "enum-entry": "class",
  annotation: "annotation",
  object: "object",
  companion: "companion",
};

function classView(k: KotlinClasses, internal: string, c: KotlinClass): KotlinView {
  const bounds = boundsOf(c.typeParameters);
  const upperBounds = upperBoundsOf(c.typeParameters, []);
  const view = membersView(
    {
      kind: CLASS_KINDS[c.kind],
      ...(c.data ? { data: true } : {}),
      ...(c.fun ? { fun: true } : {}),
      ...(c.modality === "sealed" ? { sealed: c.sealedSubclasses } : {}),
      ...(c.valueClass ? { value: c.valueClass } : {}),
      ...(bounds ? { bounds } : {}),
      ...(upperBounds ? { upperBounds } : {}),
    },
    [c],
  );

  for (const ctor of c.constructors) {
    if (ctor.jvm)
      view.members.set(ctor.jvm.name + ctor.jvm.descriptor, {
        role: "constructor",
        constructor: ctor,
      });
    if (ctor.jvm && ctor.parameters.some((p) => p.declaresDefault))
      view.overloaded.add(ctor.jvm.name);
  }

  for (const name of [
    ...c.enumEntries,
    ...(c.kind === "object" ? ["INSTANCE"] : []),
    ...(c.companionObject ? [c.companionObject] : []),
  ])
    view.nonNullFields.add(name);

  // A companion's @JvmStatic members are statics of the class too.
  const companion = c.companionObject && decoded(k, `${internal}$${c.companionObject}`);
  if (companion && "declaration" in companion && companion.declaration)
    for (const key of jvmMemberRoles(companion.declaration).keys()) view.bridges.add(key);

  return view;
}

/** The view of what declares functions and properties: a class, a facade's file or files. */
function membersView(
  facts: KotlinView["facts"],
  owners: {
    functions: KotlinFunction[];
    properties: KotlinProperty[];
    typeParameters?: KotlinTypeParameter[];
  }[],
): KotlinView {
  const view: KotlinView = {
    facts,
    members: new Map(),
    properties: [],
    bridges: new Set(),
    overloaded: new Set(),
    nonNullFields: new Set(),
  };

  for (const owner of owners) {
    for (const f of owner.functions) {
      if (!f.jvm) continue;

      view.members.set(f.jvm.name + f.jvm.descriptor, {
        role: "function",
        function: f,
        outer: owner.typeParameters ?? [],
      });
      if (f.parameters.some((p) => p.declaresDefault)) view.overloaded.add(f.jvm.name);
    }

    for (const p of owner.properties) {
      if (p.getter.jvm)
        view.members.set(p.getter.jvm.name + p.getter.jvm.descriptor, {
          role: "getter",
          property: p,
        });
      if (p.setter?.jvm)
        view.members.set(p.setter.jvm.name + p.setter.jvm.descriptor, {
          role: "setter",
          property: p,
        });
      if (!p.receiver) view.properties.push(p);
    }
  }

  return view;
}

/**
 * The bounds of type parameters other than `Any?`: `non-null` for `Any`,
 * `other` for anything else; undefined when none has one.
 */
function boundsOf(params: readonly KotlinTypeParameter[]): TypeParamBounds | undefined {
  const bounds: TypeParamBounds = {};

  for (const p of params) {
    const [only, ...more] = p.upperBounds;
    if (!only) continue;

    const any =
      !more.length && "class" in only.classifier && only.classifier.class === "kotlin/Any";
    if (any && only.nullable) continue;

    bounds[p.name] = any ? "non-null" : "other";
  }

  return Object.keys(bounds).length ? bounds : undefined;
}

/**
 * The upper bounds of `params` bounded other than by Any, as a shim
 * writes them; `outer` are the type parameters around them their bounds
 * may also name. Undefined when there is none.
 */
function upperBoundsOf(
  params: readonly KotlinTypeParameter[],
  outer: readonly KotlinTypeParameter[],
): TypeParamUpperBounds | undefined {
  const names = new Map([...outer, ...params].map((p) => [p.id, p.name]));
  const bounds = boundsOf(params) ?? {};
  const upper: TypeParamUpperBounds = {};

  for (const p of params) {
    if (bounds[p.name] !== "other") continue;

    const refs = p.upperBounds.map((b) => typeRef(b, names));
    if (refs.every((r) => r !== undefined)) upper[p.name] = refs as KotlinTypeRef[];
  }

  return Object.keys(upper).length ? upper : undefined;
}

/** A Kotlin type as a shim writes it; undefined for a use-site projection or a name it cannot reach. */
function typeRef(t: KotlinType, names: ReadonlyMap<number, string>): KotlinTypeRef | undefined {
  const c = t.classifier;
  const name =
    "class" in c
      ? c.class.replaceAll("/", ".")
      : "typeAlias" in c
        ? c.typeAlias.replaceAll("/", ".")
        : names.get(c.typeParameter);
  if (!name) return undefined;

  const args: (KotlinTypeRef | "*")[] = [];
  for (const a of t.arguments) {
    if (a === "*") {
      args.push("*");
      continue;
    }
    if (a.variance !== "invariant") return undefined;

    const ref = typeRef(a.type, names);
    if (!ref) return undefined;
    args.push(ref);
  }

  return {
    name,
    ...(args.length ? { args } : {}),
    ...(t.nullable ? { nullable: true as const } : {}),
  };
}

/** One JVM parameter as Kotlin declares it. */
export interface KotlinParam {
  name: string;
  type: KotlinType;
  facts?: KotlinParamFacts;
}

/**
 * A JVM method's Kotlin signature: a name and type for each of its JVM
 * parameters in order (context parameters, the receiver, the source
 * parameters; a suspend function's continuation is not one), the Kotlin
 * result type (none for constructors and setters), and the facts the JVM
 * signature does not show.
 */
export interface KotlinSignature {
  /** A function's Kotlin name; accessors and constructors keep the JVM's. */
  name?: string;
  params: KotlinParam[];
  returns?: KotlinType;
  facts: KotlinMemberFacts;
}

export function kotlinSignature(member: KotlinMember): KotlinSignature {
  switch (member.role) {
    case "function": {
      const f = member.function;
      const receiver = f.receiver ? [{ name: "receiver", type: f.receiver }] : [];
      const bounds = boundsOf(f.typeParameters);
      const upperBounds = upperBoundsOf(f.typeParameters, member.outer);

      return {
        name: f.name,
        params: [...(f.contextParameters ?? []), ...receiver, ...f.parameters].map((p) => ({
          name: p.name,
          type: p.type,
          ...paramFacts(p),
        })),
        returns: f.returnType,
        facts: {
          ...(f.suspend ? { suspend: true } : {}),
          ...(f.receiver ? { extension: true } : {}),
          ...(bounds ? { bounds } : {}),
          ...(upperBounds ? { upperBounds } : {}),
        },
      };
    }

    case "constructor":
      return {
        params: member.constructor.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          ...paramFacts(p),
        })),
        facts: {},
      };

    case "getter":
    case "setter": {
      const p = member.property;
      const receiver = p.receiver ? [{ name: "receiver", type: p.receiver }] : [];
      const value = member.role === "setter" ? [{ name: "value", type: p.type }] : [];

      return {
        params: [...receiver, ...value],
        ...(member.role === "getter" ? { returns: p.type } : {}),
        facts: p.receiver ? { extension: true } : {},
      };
    }
  }
}

function paramFacts(p: { declaresDefault?: true; type: KotlinType }): { facts?: KotlinParamFacts } {
  const facts: KotlinParamFacts = {
    ...(p.declaresDefault ? { default: true } : {}),
    ...(p.type.suspend ? { suspendFunction: true } : {}),
  };

  return Object.keys(facts).length ? { facts } : {};
}

/** Whether a class (`dev/orbit/HitId`) is a Kotlin value class, as its own metadata says. */
export function isValueClass(k: KotlinClasses, internal: string): boolean {
  const d = decoded(k, internal);
  return (
    !!d && "declaration" in d && d.declaration?.metadataKind === "class" && !!d.declaration.value
  );
}
