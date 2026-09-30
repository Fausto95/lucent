import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  formatSchemaType,
  markGroupIntegers,
  parseSchemaType,
  type PrimName,
  SCHEMA_FORMAT,
  type SchemaProvenance,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
} from "./schema.ts";
import { ACC, type ClassFile, type MemberInfo, parseClass } from "./classfile.ts";
import { classThreadFlags, memberThreadFlags, threadFacts, type ThreadMark } from "./facts.ts";
import {
  addKotlinClass,
  isValueClass,
  kotlinApi,
  kotlinClasses,
  type KotlinClasses,
  kotlinSignature,
  type KotlinSignature,
  kotlinView,
  type KotlinView,
} from "./kotlin.ts";
import type { KotlinType } from "./kotlin-metadata.ts";
import { jvmDescriptorOf } from "./kotlin-metadata-decode.ts";
import { extractorVersion, jarArtifact, jvmSymbol } from "./provenance.ts";
import { ZipArchive } from "./zip.ts";

/**
 * Binding schemas for Java packages, read from class files (android.jar, and
 * the jars inside AARs). Nullability comes from annotations (unannotated
 * references are nullable), API levels from the SDK's api-versions.xml.
 * Classes kotlinc wrote are declared as their Kotlin metadata says (see
 * kotlin.ts), each member keeping the JVM method it is.
 */
export interface AndroidOptions {
  jars: string[];
  /** The SDK's platforms/android-N/data/api-versions.xml. */
  apiVersions?: string;
  /** Java packages to extract; references to classes outside them are not typed. */
  packages: string[];
  /** The SDK's platforms/android-N/data/annotations.zip: @RequiresPermission, per package. */
  annotations?: string;
  /** Collects the packages whose classes the extraction looked up (its own among them). */
  consulted?: Set<string>;
}

const NON_NULL = new Set([
  "Landroid/annotation/NonNull;",
  "Landroidx/annotation/NonNull;",
  "Landroidx/annotation/RecentlyNonNull;",
  "Lorg/jetbrains/annotations/NotNull;",
  "Ljavax/annotation/Nonnull;",
  "Llibcore/util/NonNull;",
]);

const isNonNull = (anns: readonly string[] | undefined) => !!anns?.some((a) => NON_NULL.has(a));

const NULLABLE = new Set([
  "Landroid/annotation/Nullable;",
  "Landroidx/annotation/Nullable;",
  "Landroidx/annotation/RecentlyNullable;",
  "Lorg/jetbrains/annotations/Nullable;",
  "Ljavax/annotation/Nullable;",
  "Llibcore/util/Nullable;",
]);

const PRIM: Record<string, string> = {
  Z: "boolean",
  B: "byte",
  C: "char",
  S: "short",
  I: "int",
  J: "long",
  F: "float",
  D: "double",
  V: "void",
};

class Unsupported extends Error {}

// --- generic signatures (JVMS §4.7.9.1) ------------------------------------------------

type JType =
  | { k: "prim"; d: string }
  | { k: "class"; name: string; args: JType[] }
  | { k: "var"; name: string }
  | { k: "array"; of: JType }
  | { k: "wildcard" };

class SigReader {
  p = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }
  peek(): string {
    return this.s[this.p]!;
  }
  typeParams(): string[] {
    const out: string[] = [];
    if (this.peek() !== "<") return out;
    this.p++;
    while (this.peek() !== ">") {
      const colon = this.s.indexOf(":", this.p);
      out.push(this.s.slice(this.p, colon));
      this.p = colon;
      while (this.peek() === ":") {
        this.p++;
        if (this.peek() !== ":" && this.peek() !== ">") this.type();
      }
    }
    this.p++;
    return out;
  }
  type(): JType {
    const c = this.s[this.p++]!;
    if (c in PRIM) return { k: "prim", d: c };
    if (c === "[") return { k: "array", of: this.type() };
    if (c === "T") {
      const end = this.s.indexOf(";", this.p);
      const name = this.s.slice(this.p, end);
      this.p = end + 1;
      return { k: "var", name };
    }
    if (c === "*") return { k: "wildcard" };
    if (c === "+" || c === "-") return this.type();
    if (c !== "L") throw new Error(`signature: unexpected ${c} in ${this.s}`);
    let name = "";
    let args: JType[] = [];
    for (;;) {
      const ch = this.s[this.p++]!;
      if (ch === ";") break;
      if (ch === "<") {
        args = [];
        while (this.peek() !== ">") args.push(this.type());
        this.p++;
      } else if (ch === ".") {
        name += "$";
        args = [];
      } else name += ch;
    }
    return { k: "class", name, args };
  }
  method(): { typeParams: string[]; params: JType[]; ret: JType } {
    const typeParams = this.typeParams();
    this.p++; // (
    const params: JType[] = [];
    while (this.peek() !== ")") params.push(this.type());
    this.p++;
    return { typeParams, params, ret: this.type() };
  }
}

// --- api-versions.xml ------------------------------------------------------------------

export interface ApiLevels {
  cls: Map<string, number>;
  member: Map<string, number>;
}

function readApiLevels(file: string | undefined): ApiLevels {
  const levels: ApiLevels = { cls: new Map(), member: new Map() };
  if (!file) return levels;
  let current = "";
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const c = /<class name="([^"]+)"(?:[^>]*\bsince="(\d+)")?/.exec(line);
    if (c) {
      current = c[1]!;
      if (c[2]) levels.cls.set(current, Number(c[2]));
      continue;
    }
    const m = /<(method|field) name="([^"]+)"[^>]*\bsince="(\d+)"/.exec(line);
    if (m && current) levels.member.set(`${current}#${m[2]}`, Number(m[3]));
  }
  return levels;
}

// --- names -----------------------------------------------------------------------------

const packageOf = (internal: string) =>
  internal.slice(0, internal.lastIndexOf("/")).replace(/\//g, ".");
const simpleOf = (internal: string) =>
  internal.slice(internal.lastIndexOf("/") + 1).replace(/\$/g, "_");
const refOf = (internal: string) => `${packageOf(internal)}.${simpleOf(internal)}`;

/**
 * Kotlin mangles the JVM names of functions taking inline classes
 * (sortArray-4UcCI2c), hiding them from Java: they are not identifiers.
 */
const mangled = (name: string) => !/^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u.test(name);

/** Kotlin's property name for a getter's suffix: Name → name, URL → url, URLPath → urlPath. */
function propertyName(suffix: string): string {
  let n = 0;
  while (n < suffix.length && suffix[n]! >= "A" && suffix[n]! <= "Z") n++;
  if (n <= 1) return suffix.charAt(0).toLowerCase() + suffix.slice(1);
  const keep = n < suffix.length ? n - 1 : n;
  return suffix.slice(0, keep).toLowerCase() + suffix.slice(keep);
}

// --- extraction ------------------------------------------------------------------------

/** Every class of a set of jars, and which are visible (public, nested in public). */
export interface JarIndex {
  classes: Map<string, ClassFile>;
  /** The jar or AAR on the classpath each class comes from. */
  origins: Map<string, string>;
  known: Set<string>;
  nestedAccess: Map<string, number>;
  /** Java packages with at least one visible class. */
  packages: Set<string>;
  levels: ApiLevels;
  /** The Kotlin metadata of the classes kotlinc wrote. */
  kotlin: KotlinClasses;
  /** Made on first use: see objectResultsNarrowed. */
  narrowed?: Map<string, { by: string; to: "a value" | "an interface" | "a type variable" }>;
}

const jarIndexes = new Map<string, JarIndex>();

/** Results TypeScript types as values: arrays and strings, not Java objects. */
const VALUE_RESULT = /\)(\[|Ljava\/lang\/String;|Ljava\/lang\/CharSequence;)/;

/** Results Lucent gives as strings. */
const STRING_RESULT = /\)(Ljava\/lang\/String;|Ljava\/lang\/CharSequence;)$/;

/** What an Object result is narrowed to, where TypeScript cannot relate it to Object. */
type Narrowing = "a value" | "an interface" | "a type variable";

/**
 * What `m`'s result narrows Object to, when TypeScript cannot relate it to
 * the Java object Object stands for: a value (an array, a string), an
 * interface (Java interfaces are structural, Object is nominal), or a type
 * variable (it may stand for a string). A class extends Object: undefined.
 */
function narrowing(m: MemberInfo, classes: Map<string, ClassFile>): Narrowing | undefined {
  if (VALUE_RESULT.test(m.descriptor)) return "a value";

  const signature = m.signature ?? m.descriptor;
  if (signature.slice(signature.indexOf(")") + 1).startsWith("T")) return "a type variable";

  const ret = /\)L([^;]+);$/.exec(m.descriptor)?.[1];
  if (ret && ret !== "java/lang/Object" && (classes.get(ret)?.access ?? 0) & ACC.INTERFACE)
    return "an interface";

  return undefined;
}

/**
 * The methods returning Object that a visible class overrides with a result
 * TypeScript cannot relate to Object (`ByteBuffer.array()` of
 * `Buffer.array()`, `ArrayAdapter<T>.getItem` of `Adapter.getItem`), keyed
 * `owner#name(descriptor)`, each with the first such class and what it
 * narrows to. The override would not be assignable: the base member is left
 * out, the override kept. A result typed by a type variable
 * (`Supplier<T>.get()`) is not Object.
 */
function objectResultsNarrowed(index: JarIndex): Map<string, { by: string; to: Narrowing }> {
  if (index.narrowed) return index.narrowed;

  const narrowed = new Map<string, { by: string; to: Narrowing }>();

  for (const internal of [...index.known].sort()) {
    const c = index.classes.get(internal)!;

    for (const m of c.methods) {
      if (!(m.access & ACC.PUBLIC) || m.access & (ACC.STATIC | ACC.SYNTHETIC | ACC.BRIDGE))
        continue;

      const to = narrowing(m, index.classes);
      if (!to) continue;

      // Up the hierarchy: each method this one overrides, directly or not.
      for (let over = overriddenMethod(internal, m, index.classes); over;) {
        const { owner, method } = over;
        const typeVariable = method.signature
          ?.slice(method.signature.indexOf(")") + 1)
          .startsWith("T");
        const key = `${owner}#${method.name}${method.descriptor}`;

        if (
          method.descriptor.endsWith(")Ljava/lang/Object;") &&
          !typeVariable &&
          !narrowed.has(key)
        )
          narrowed.set(key, { by: internal, to });

        over = overriddenMethod(owner, method, index.classes);
      }
    }
  }

  index.narrowed = narrowed;
  return narrowed;
}

/** The class archives of a jar, or of an AAR (classes.jar and libs/*.jar). */
function classArchives(file: string, zip = new ZipArchive(file)): ZipArchive[] {
  if (!file.endsWith(".aar")) return [zip];

  return zip
    .names()
    .filter((n) => n === "classes.jar" || /^libs\/[^/]+\.jar$/.test(n))
    .map((n) => new ZipArchive(zip.read(n)!));
}

/** A class file's internal name, for entries that are classes (not module-info, package-info, META-INF). */
function classEntry(entry: string): string | undefined {
  if (!entry.endsWith(".class") || entry.includes("-") || entry.startsWith("META-INF/"))
    return undefined;

  return entry.slice(0, -".class".length);
}

/**
 * What a jar or AAR declares, from its zip directories alone (no class is
 * read, so indexing a classpath is cheap): the Java packages it has
 * classes in, and a hash of those classes and its annotations by name and
 * CRC. Archives written again with other timestamps keep the hash.
 */
export function archiveIndex(file: string): { packages: string[]; contentHash: string } {
  const packages = new Set<string>();
  const entries: string[] = [];

  const outer = new ZipArchive(file);
  if (file.endsWith(".aar")) entries.push(`annotations.zip ${outer.digest("annotations.zip")}`);

  for (const zip of classArchives(file, outer))
    for (const entry of zip.names()) {
      const internal = classEntry(entry);
      if (!internal) continue;

      entries.push(`${entry} ${zip.digest(entry)}`);
      if (internal.includes("/")) packages.add(packageOf(internal));
    }

  const contentHash = createHash("sha256").update(entries.sort().join("\n")).digest("hex");
  return { packages: [...packages].sort(), contentHash: contentHash.slice(0, 16) };
}

/** `index` as it is, telling `note` each class name looked up in it. */
function noting<T extends Map<string, unknown> | Set<string>>(
  index: T,
  note: (k: string) => void,
): T {
  return new Proxy(index, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (prop === "get" || prop === "has")
        return (key: string) => {
          note(key);
          return (value as (k: string) => unknown).call(target, key);
        };

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Reads all classes of `jars` (once per process per identity: a few hundred ms for android.jar). */
export function jarIndex(jars: string[], apiVersions: string | undefined): JarIndex {
  const identity = [...jars, apiVersions ?? ""]
    .map((f) =>
      f && fs.existsSync(f) ? `${f}:${fs.statSync(f).size}:${fs.statSync(f).mtimeMs}` : f,
    )
    .join("|");
  const cached = jarIndexes.get(identity);
  if (cached) return cached;
  const classes = new Map<string, ClassFile>();
  const origins = new Map<string, string>();
  const kotlin = kotlinClasses();
  const archives = jars.flatMap((file) => classArchives(file).map((zip) => ({ file, zip })));
  for (const { file, zip } of archives) {
    for (const entry of zip.names()) {
      const internal = classEntry(entry);
      if (!internal) continue;
      // The first jar on the classpath wins, as in the class loader.
      if (classes.has(internal)) continue;

      const bytes = zip.read(entry)!;
      classes.set(internal, parseClass(bytes));
      addKotlinClass(kotlin, internal, bytes);
      origins.set(internal, file);
    }
  }
  // Public top-level classes, and public nested classes of public classes.
  const nestedAccess = new Map<string, number>();
  for (const c of classes.values())
    for (const ic of c.innerClasses) if (ic.inner === c.name) nestedAccess.set(c.name, ic.access);
  const visible = (internal: string): boolean => {
    const c = classes.get(internal);
    if (!c || c.access & ACC.SYNTHETIC) return false;
    if (!kotlinApi(kotlin, internal)) return false;
    // Annotation types are types only when they hold constants (a named constant group).
    if (c.access & ACC.ANNOTATION && !constantFields(c).length) return false;
    if (!internal.includes("$")) return !!(c.access & ACC.PUBLIC);
    const access = nestedAccess.get(internal);
    if (access === undefined || !(access & ACC.PUBLIC) || /\$\d/.test(internal)) return false;
    return visible(internal.slice(0, internal.lastIndexOf("$")));
  };
  const known = new Set([...classes.keys()].filter(visible));
  const index: JarIndex = {
    classes,
    origins,
    known,
    nestedAccess,
    packages: new Set([...known].map(packageOf)),
    levels: readApiLevels(apiVersions),
    kotlin,
  };
  jarIndexes.set(identity, index);
  return index;
}

export function extractAndroid(opts: AndroidOptions): SdkModuleSchema[] {
  const index = jarIndex(opts.jars, opts.apiVersions);
  const { origins, levels } = index;
  const narrowed = objectResultsNarrowed(index);

  // What the schema depends on: every class it looked up, by package.
  const consulted = opts.consulted;
  const note = consulted ? (internal: string) => consulted.add(packageOf(internal)) : undefined;
  const classes = note ? noting(index.classes, note) : index.classes;
  const known = note ? noting(index.known, note) : index.known;
  const nestedAccess = note ? noting(index.nestedAccess, note) : index.nestedAccess;
  for (const pkg of opts.packages) consulted?.add(pkg);

  const modules = new Map<string, SdkModuleSchema>();
  for (const pkg of opts.packages)
    modules.set(pkg, {
      format: SCHEMA_FORMAT,
      platform: "android",
      module: pkg,
      types: [],
      skipped: [],
    });

  // The packages' annotations, and their supertypes' packages': an override
  // keeps the contract of the method it overrides, wherever that is declared.
  const annotated = packagesAbove(opts.packages, index.classes, index.known);
  for (const pkg of annotated) consulted?.add(pkg);

  const notes = readAnnotations(
    [
      ...(opts.annotations && fs.existsSync(opts.annotations)
        ? [new ZipArchive(opts.annotations)]
        : []),
      ...aarAnnotations(opts.jars),
    ],
    annotated,
    (dotted) => constantRef(dotted, classes, known),
  );

  // A method's result contract: its own nullness and constant group, or
  // (for an override without them) the contract of the method it overrides,
  // itself perhaps inherited: an override implements that contract. A
  // non-null result stays non-null whatever the override says: callers of
  // the overridden method were promised one. A static hiding another keeps
  // its contract the same way.
  const contracts = new Map<string, { nonNull: boolean; oneOf?: string[] }>();
  const resultContract = (owner: string, m: MemberInfo): { nonNull: boolean; oneOf?: string[] } => {
    const key = `${owner}#${m.name}${m.descriptor}`;
    const known = contracts.get(key);
    if (known) return known;

    // Placeholder against cycles through malformed hierarchies.
    contracts.set(key, { nonNull: isNonNull(m.annotations) });

    const own = notes.oneOf.get(javaMemberKey(owner, m));
    const annotated = m.annotations.some((a) => NON_NULL.has(a) || NULLABLE.has(a));
    const over = overriddenMethod(owner, m, classes);
    const inherited = over ? resultContract(over.owner, over.method) : undefined;

    const contract = {
      nonNull: (annotated && isNonNull(m.annotations)) || (inherited?.nonNull ?? false),
      ...((own ?? inherited?.oneOf) ? { oneOf: own ?? inherited!.oneOf } : {}),
    };
    contracts.set(key, contract);

    return contract;
  };
  for (const internal of [...known].sort()) {
    const mod = modules.get(packageOf(internal));
    if (!mod) continue;
    const c = classes.get(internal)!;
    if (c.access & ACC.ANNOTATION) {
      // A named constant group (Play services' Priority): an enum.
      mod.types.push({
        kind: "enum",
        name: simpleOf(internal),
        native: internal,
        symbol: jvmSymbol(internal),
        // Numbers, as Java's @IntDef groups are: a long group's values a number holds exactly.
        cases: constantFields(c).map((f) => ({
          name: f.name,
          native: f.name,
          value: typeof f.constant === "bigint" ? Number(f.constant) : f.constant!,
        })),
      });
      continue;
    }
    const isInterface = !!(c.access & ACC.INTERFACE);
    const innerClass =
      internal.includes("$") && !((nestedAccess.get(internal) ?? 0) & ACC.STATIC) && !isInterface;
    const cls: SdkClassSchema = {
      kind: "class",
      name: simpleOf(internal),
      native: internal,
      symbol: jvmSymbol(internal),
    };
    if (isInterface) cls.interface = true;
    else if (c.access & ACC.ABSTRACT) cls.abstract = true;
    const since = levels.cls.get(internal);
    if (since && since > 1) cls.since = since;
    const classParams = c.signature ? new SigReader(c.signature).typeParams() : [];
    if (classParams.length) cls.typeParams = classParams;
    const classThread = notes.threads.get(internal.replace(/[/$]/g, "."));
    if (classThread) cls.facts = threadFacts(classThread);
    Object.assign(cls, classThreadFlags(cls.facts));

    const skip = (m: MemberInfo, reason: string) =>
      mod.skipped!.push(`${internal.replace(/\//g, ".")}.${m.name}${m.descriptor}: ${reason}`);

    // What its supertypes show TypeScript by name: a property and a method of one name clash.
    const inherited = inheritedNames(internal, classes, (sup) => !!kotlinView(index.kotlin, sup));

    // Declared in Kotlin: as its metadata says, or (unreadable) as Java sees it, saying why.
    const read = kotlinView(index.kotlin, internal);
    if (read && "unread" in read)
      mod.skipped!.push(
        `${internal.replace(/\//g, ".")}: its Kotlin metadata was not read (${read.unread})`,
      );
    const kotlin = read && !("unread" in read) ? read : undefined;

    /**
     * A JVM type as a schema type. `kt`, the Kotlin type at the same place,
     * says whether it is nullable where Java does not (a platform type is
     * unknown to Kotlin too), down to type arguments and array elements.
     */
    const typeOf = (
      t: JType,
      javaNonNull: boolean,
      tparams: readonly string[],
      kt?: KotlinType,
    ): SchemaType => {
      const nonNull = kt && !kt.platform ? !kt.nullable : javaNonNull;
      const nullable = (x: SchemaType): SchemaType => (nonNull ? x : { ...x, nullable: true });
      const argument = (i: number, of: number) =>
        kt?.arguments.length === of ? typeArgument(kt, i) : undefined;

      switch (t.k) {
        case "prim":
          return parseSchemaType(PRIM[t.d]!);
        case "array": {
          const inner = typeOf(t.of, true, tparams, argument(0, 1));
          if (inner.nullable) throw new Unsupported("nullable array element");
          return nullable({ k: "array", of: inner, nullable: false });
        }
        case "var":
          if (!tparams.includes(t.name)) throw new Unsupported(`type variable ${t.name}`);
          return nullable({ k: "tparam", name: t.name, nullable: false });
        case "wildcard":
          throw new Unsupported("wildcard");
        case "class": {
          if (t.name === "java/lang/String") return nullable(parseSchemaType("string"));
          if (t.name === "java/lang/CharSequence") return nullable(parseSchemaType("CharSequence"));
          if (t.name === "java/lang/Class") {
            const arg = t.args[0];
            if (arg?.k === "var" && tparams.includes(arg.name))
              return nullable({ k: "classOf", param: arg.name, nullable: false });
            throw new Unsupported("java.lang.Class");
          }
          if (!known.has(t.name)) throw new Unsupported(t.name.replace(/\//g, "."));

          // A type argument: a number or boolean Kotlin boxes is one.
          const typeArg = (a: JType, i: number) => {
            const at = argument(i, t.args.length);
            return boxedAs(at, a) ?? typeOf(a, true, tparams, at);
          };

          // Kotlin's read-only List of typed elements: a copy of them.
          if (readOnlyList(t, kt)) {
            try {
              return nullable({
                k: "array",
                of: typeArg(t.args[0]!, 0),
                nullable: false,
                list: true,
              });
            } catch (e) {
              if (!(e instanceof Unsupported)) throw e;
            }
          }

          const ref = parseSchemaType(refOf(t.name));
          // Type arguments, bounded wildcards as their bound; any other stays raw.
          let args: SchemaType[] | undefined;
          try {
            args = t.args.length ? t.args.map(typeArg) : undefined;
          } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
          }
          return nullable(args && ref.k === "ref" ? { ...ref, args } : ref);
        }
      }
    };
    // Supertypes with their type arguments (ArrayList<E> implements List<E>).
    const generic = new Map<string, string>();
    if (c.signature) {
      const sig = new SigReader(c.signature);
      sig.typeParams();
      while (sig.p < sig.s.length) {
        const sup = sig.type();
        if (sup.k !== "class" || !known.has(sup.name)) continue;
        try {
          generic.set(sup.name, formatSchemaType(typeOf(sup, true, classParams)));
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
        }
      }
    }
    const supertype = (name: string) => generic.get(name) ?? refOf(name);
    if (c.superName && c.superName !== "java/lang/Object" && known.has(c.superName))
      cls.extends = supertype(c.superName);
    const ifaces = c.interfaces.filter((i) => known.has(i)).map(supertype);
    if (ifaces.length) cls.implements = ifaces;
    const nonNull = (anns: string[] | undefined) => !!anns?.some((a) => NON_NULL.has(a));

    /** A value class the JVM passes as its underlying value here, as its Kotlin type. */
    const unboxedAs = (kt: KotlinType | undefined, t: JType): SchemaType | undefined => {
      const name = kt && "class" in kt.classifier ? kt.classifier.class.replaceAll(".", "$") : "";
      if (!name || (t.k === "class" && t.name === name)) return undefined;
      if (!isValueClass(index.kotlin, name)) return undefined;

      if (!known.has(name)) throw new Unsupported(name.replace(/\//g, "."));
      return { ...parseSchemaType(refOf(name)), nullable: kt!.nullable };
    };

    /** What a suspend function completes with, from its continuation (`Continuation<T>`). */
    const completion = (
      continuation: JType,
      kt: KotlinType | undefined,
      scope: readonly string[],
    ): SchemaType => {
      const name = kt && "class" in kt.classifier ? kt.classifier.class : undefined;
      if (name === "kotlin/Unit") return parseSchemaType("void");

      // A Kotlin primitive, boxed as the continuation's type argument.
      const primitive = name && !kt!.nullable ? PRIM[jvmDescriptorOf(name)] : undefined;
      if (primitive) return parseSchemaType(primitive);

      const value = continuation.k === "class" ? continuation.args[0] : undefined;
      if (!value) throw new Unsupported("a suspend function without its generic signature");
      return typeOf(value, false, scope, kt);
    };

    /**
     * A suspend function type, as Kotlin declares it: the JVM's
     * `FunctionN<A…, Continuation<R>, Object>` is a function of `A…` giving `R`.
     */
    const suspendFunction = (t: JType, kt: KotlinType, scope: readonly string[]): SchemaType => {
      if (t.k !== "class" || t.args.length < 2 || kt.arguments.length !== t.args.length)
        throw new Unsupported("a suspend function type without its generic signature");

      const last = t.args.length - 2;

      return {
        k: "fn",
        params: t.args.slice(0, last).map((a, i) => typeOf(a, true, scope, typeArgument(kt, i))),
        ret: completion(t.args[last]!, typeArgument(typeArgument(kt, last), 0), scope),
        escaping: true,
        main: false,
        nullable: kt.nullable,
      };
    };

    const props: SdkPropertySchema[] = [];
    for (const f of c.fields) {
      if (!(f.access & ACC.PUBLIC) || f.access & ACC.SYNTHETIC) continue;

      // A Kotlin property read through accessors: its field is not another property.
      const declared = kotlin?.properties.find((p) => p.field?.name === f.name);
      if (declared?.getter.jvm) continue;

      // Holding a Kotlin class that is not API (an internal companion): not API either.
      const held = /^L(.+);$/.exec(f.descriptor)?.[1];
      if (kotlin && held && !kotlinApi(index.kotlin, held)) continue;

      if (mangled(f.name)) {
        skip(f, "Kotlin-mangled name");
        continue;
      }
      let type: SchemaType;
      try {
        type = typeOf(
          new SigReader(f.signature ?? f.descriptor).type(),
          nonNull(f.annotations) || !!(f.access & ACC.STATIC && kotlin?.nonNullFields.has(f.name)),
          f.access & ACC.STATIC ? [] : classParams,
          declared?.type,
        );
      } catch (e) {
        if (e instanceof Unsupported) {
          skip(f, e.message);
          continue;
        }
        throw e;
      }
      const p: SdkPropertySchema = {
        name: f.name,
        type,
        symbol: jvmSymbol(internal, `${f.name}:${f.descriptor}`),
      };
      if (f.access & ACC.STATIC) p.static = true;
      p.readonly = !!(f.access & ACC.FINAL);
      if (f.access & ACC.STATIC && f.access & ACC.FINAL && f.constant !== undefined) {
        const constant = f.constant;

        // A long's value as its decimal digits: exact, which a number is not beyond 2^53.
        p.value =
          formatSchemaType(type) === "boolean"
            ? constant === 1
            : typeof constant === "bigint"
              ? `${constant}`
              : constant;
        if (typeof constant === "string") p.type = parseSchemaType("string");
      }
      const fs = levels.member.get(`${internal}#${f.name}`);
      if (fs && fs > ((cls.since as number | undefined) ?? 1)) p.since = fs;
      if (f.deprecated) p.deprecated = true;
      props.push(p);
    }

    const ctors: SdkCallable[] = [];
    const methods: SdkMethodSchema[] = [];
    for (const m of [...c.methods].sort((a, b) =>
      a.name === b.name ? (a.descriptor < b.descriptor ? -1 : 1) : a.name < b.name ? -1 : 1,
    )) {
      // Protected constructors too: a Lucent subclass calls them.
      const visible = m.access & ACC.PUBLIC || (m.name === "<init>" && m.access & ACC.PROTECTED);
      if (!visible || m.access & (ACC.SYNTHETIC | ACC.BRIDGE) || m.name === "<clinit>") continue;

      // In Kotlin: a declaration, or what Kotlin generates for Java callers; the rest is not API.
      const member = kotlin?.members.get(m.name + m.descriptor);
      if (kotlin && !member && !generatedForJava(kotlin, internal, m, classes)) continue;

      // A value class's members are statics of its underlying value; generated ones have boxed overrides.
      if (kotlin?.facts.value && member?.role !== "constructor" && m.access & ACC.STATIC) {
        if (member?.role !== "function" || member.function.memberKind !== "synthesized")
          skip(m, "a value class's member, which the JVM implements on its unboxed value");
        continue;
      }

      // An abstract class's constructors stay: TypeScript refuses `new`, a subclass calls them.
      if (m.name === "<init>" && (isInterface || innerClass)) continue;
      if (!member && m.name !== "<init>" && mangled(m.name)) {
        skip(m, "Kotlin-mangled name");
        continue;
      }

      // A string result (CharSequence) narrowed to a Java object (EditText.getText's Editable):
      // TypeScript cannot relate them, and the method it overrides gives the same object as a string.
      const stringBase =
        m.access & ACC.STATIC || m.name === "<init>" || STRING_RESULT.test(m.descriptor)
          ? undefined
          : overriddenMethod(internal, m, classes);
      if (
        stringBase &&
        STRING_RESULT.test(stringBase.method.descriptor) &&
        /\)L/.test(m.descriptor)
      ) {
        skip(
          m,
          `narrows the string ${dotted(stringBase.owner)}.${m.name} returns to a Java object: that one is called`,
        );
        continue;
      }

      // A result typed by a type variable where the method it overrides gives a class or
      // interface (Spliterator.OfPrimitive's T_SPLITR trySplit()): Java bounds the variable
      // by that type, which the declarations' type parameters do not say.
      const signature = m.signature ?? m.descriptor;
      const variable =
        !(m.access & ACC.STATIC) && signature.slice(signature.indexOf(")") + 1).startsWith("T");
      const bounded = variable ? overriddenMethod(internal, m, classes) : undefined;
      if (
        bounded &&
        /\)L/.test(bounded.method.descriptor) &&
        !bounded.method.descriptor.endsWith(")Ljava/lang/Object;")
      ) {
        const overriddenSignature = bounded.method.signature ?? bounded.method.descriptor;
        if (!overriddenSignature.slice(overriddenSignature.indexOf(")") + 1).startsWith("T")) {
          skip(
            m,
            `returns a type variable bounded by what ${dotted(bounded.owner)}.${m.name} returns, a bound the declarations do not carry`,
          );
          continue;
        }
      }

      const narrowedBy = narrowed.get(`${internal}#${m.name}${m.descriptor}`);
      if (narrowedBy) {
        note?.(narrowedBy.by);
        skip(
          m,
          `returns Object, which ${narrowedBy.by.replace(/\//g, ".")} narrows to ${narrowedBy.to}`,
        );
        continue;
      }

      let sig: { typeParams: string[]; params: JType[]; ret: JType };
      try {
        sig = new SigReader(m.signature ?? m.descriptor).method();
        // Signatures omit synthetic parameters; descriptors are what JNI needs.
        const erased = new SigReader(m.descriptor).method();
        if (erased.params.length !== sig.params.length) sig = erased;
      } catch {
        skip(m, "unreadable signature");
        continue;
      }
      const contract = m.name === "<init>" ? undefined : resultContract(internal, m);
      const resultNonNull = contract?.nonNull ?? nonNull(m.annotations);

      // Its Kotlin signature, when it names each JVM parameter (a suspend function's continuation aside).
      const declaredAs: KotlinSignature | undefined = member && kotlinSignature(member);
      const ks =
        declaredAs &&
        declaredAs.params.length + (declaredAs.facts.suspend ? 1 : 0) === sig.params.length
          ? declaredAs
          : undefined;
      // A value class's constructor, which gives the value it wraps.
      let unboxed = member?.role === "constructor" && m.name !== "<init>";

      let params: SdkParam[];
      let returns: SchemaType;
      try {
        // A class's type parameters are in scope in its instance members and constructors.
        const scope = m.access & ACC.STATIC ? sig.typeParams : [...sig.typeParams, ...classParams];
        const given = ks ? sig.params.slice(0, ks.params.length) : sig.params;

        params = given.map((t, i) => {
          const kp = ks?.params[i];
          const value = kp && !kp.facts?.suspendFunction ? unboxedAs(kp.type, t) : undefined;
          if (value) unboxed = true;

          const type = kp?.facts?.suspendFunction
            ? suspendFunction(t, kp.type, scope)
            : (value ?? typeOf(t, nonNull(m.paramAnnotations[i]), scope, kp?.type));
          return { name: kp?.name ?? `arg${i}`, type, ...(kp?.facts ? { kotlin: kp.facts } : {}) };
        });

        const result =
          ks?.returns && !ks.facts.suspend ? unboxedAs(ks.returns, sig.ret) : undefined;
        if (result) unboxed = true;

        returns = ks?.facts.suspend
          ? completion(sig.params.at(-1)!, ks.returns, scope)
          : (result ?? typeOf(sig.ret, resultNonNull, scope, ks?.returns));
      } catch (e) {
        if (e instanceof Unsupported) {
          skip(m, e.message);
          continue;
        }
        throw e;
      }
      const javaKey = `${internal.replace(/[/$]/g, ".")} ${m.name === "<init>" ? simpleOf(internal).split("_").pop() : m.name}(${javaParams(m.descriptor).join(", ")})`;
      params.forEach((p, i) => {
        const oneOf = notes.oneOf.get(`${javaKey} ${i}`);
        if (oneOf) p.oneOf = oneOf;
      });
      const ms = levels.member.get(`${internal}#${m.name}${m.descriptor}`);
      const since = ms && ms > ((cls.since as number | undefined) ?? 1) ? ms : undefined;
      const symbol = jvmSymbol(internal, `${m.name}${m.descriptor}`);
      // Its own thread annotation; without one, its class's facts hold.
      const thread = notes.threads.get(javaKey);
      const facts = thread ? threadFacts(thread) : undefined;
      const kotlinFacts = { ...ks?.facts, ...(unboxed ? { unboxed: true as const } : {}) };

      if (m.name === "<init>" || member?.role === "constructor") {
        const ctor: SdkCallable = { params, descriptor: m.descriptor, symbol };
        if (!(m.access & ACC.PUBLIC)) ctor.protected = true;
        if (facts) ctor.facts = facts;
        if (Object.keys(kotlinFacts).length) ctor.kotlin = kotlinFacts;
        if (since) ctor.since = since;
        if (m.deprecated) ctor.deprecated = true;
        ctors.push(ctor);
        continue;
      }
      const property = m.access & ACC.STATIC ? undefined : inherited.properties.get(m.name);
      if (property) {
        skip(
          m,
          `named like the property ${m.name} of ${dotted(property.owner)} (${property.from})`,
        );
        continue;
      }

      const method: SdkMethodSchema = {
        name: m.name,
        params,
        returns,
        descriptor: m.descriptor,
        symbol,
      };
      if (ks?.name && ks.name !== m.name) {
        method.name = ks.name;
        method.java = m.name;
      }
      if (Object.keys(kotlinFacts).length) method.kotlin = kotlinFacts;
      if (m.access & ACC.STATIC) method.static = true;
      if (m.access & ACC.ABSTRACT) method.abstract = true;
      const needs = notes.permissions.get(javaKey);
      if (needs) method.permissions = needs;
      const returnsOneOf = contract?.oneOf ?? notes.oneOf.get(javaKey);
      if (returnsOneOf) method.returnsOneOf = returnsOneOf;
      if (facts) method.facts = facts;
      Object.assign(method, memberThreadFlags(cls.facts, facts));
      if (sig.typeParams.length) method.typeParams = sig.typeParams;
      if (since) method.since = since;
      if (m.deprecated) method.deprecated = true;
      methods.push(method);

      // Kotlin-style properties for getters (Kotlin classes declare their own).
      const getter = /^(get|is)([A-Z].*)$/.exec(m.name);
      if (
        !kotlin &&
        getter &&
        !method.static &&
        !params.length &&
        formatSchemaType(returns) !== "void" &&
        (getter[1] === "get" || formatSchemaType(returns) === "boolean")
      ) {
        const name = propertyName(getter[2]!);

        // Named like a supertype's method (TextView.getLayout's layout, View's layout()):
        // TypeScript cannot have both, and the getter itself stays callable.
        if (!inherited.methods.has(name) && !props.some((p) => p.name === name)) {
          const p: SdkPropertySchema = {
            name,
            readonly: true,
            getter: m.name,
            type: returns,
            symbol,
          };
          if (since) p.since = since;
          if (returnsOneOf) p.oneOf = returnsOneOf;
          // As its getter's.
          if (facts) p.facts = facts;
          Object.assign(p, memberThreadFlags(cls.facts, facts));
          props.push(p);
        }
      }
    }
    if (kotlin) {
      props.push(...kotlinProperties(kotlin, methods, props));

      // What the metadata names that the class files lack (the class's, or those it inherits
      // them from: multi-file parts can be superclasses): nothing calls it, and the schema says
      // so. Inline functions may have no JVM method callers can reach (@InlineOnly).
      const jvm = new Set<string>();
      for (
        let k: ClassFile | undefined = c;
        k;
        k = k.superName ? classes.get(k.superName) : undefined
      )
        for (const m of k.methods) jvm.add(m.name + m.descriptor);
      for (const [key, member] of kotlin.members)
        if (!jvm.has(key) && !(member.role === "function" && member.function.inline))
          mod.skipped!.push(
            `${internal.replace(/\//g, ".")}.${key}: its Kotlin metadata names a JVM method the class file does not have`,
          );

      // Sealed subclasses Lucent declares, and a value class's underlying type.
      const { sealed, value, ...facts } = kotlin.facts;
      cls.kotlin = facts;
      if (sealed)
        cls.kotlin.sealed = sealed
          .map((name) => name.replaceAll(".", "$"))
          .filter((name) => known.has(name))
          .map(refOf);
      if (value && "class" in value.type.classifier) {
        const jvm = new SigReader(jvmDescriptorOf(value.type.classifier.class)).type();
        try {
          cls.kotlin.value = { property: value.property, type: typeOf(jvm, true, [], value.type) };
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
        }
      }
    }

    renameOverloads(methods);
    if (isInterface) renameDefaultOverloads(methods);
    if (isInterface) {
      // Java's rule for what a lambda implements: one abstract method, inherited ones counted.
      const abstract = abstractMethods(internal, classes);
      const only =
        abstract.length === 1
          ? methods.find((x) => x.abstract && `${x.java ?? x.name}${x.descriptor}` === abstract[0])
          : undefined;
      if (only) cls.functional = only.name;
    }

    // TypeScript's constructor overloads share one access: beside public ones, protected ones go.
    const publicCtors = ctors.filter((x) => !x.protected);
    if (publicCtors.length)
      for (const x of ctors.filter((c) => c.protected))
        mod.skipped!.push(
          `${internal.replace(/\//g, ".")}.<init>${x.descriptor}: protected, beside public constructors (TypeScript's overloads share one access)`,
        );
    const kept = publicCtors.length ? publicCtors : ctors;
    if (kept.length) cls.constructors = kept;
    if (methods.length) cls.methods = methods;
    if (props.length) cls.properties = props;
    mod.types.push(cls);
  }

  for (const mod of modules.values()) {
    markGroupIntegers(mod);
    const provenance = androidProvenance(mod.module, opts.jars, known, origins);
    if (provenance) mod.provenance = provenance;
  }

  return [...modules.values()];
}

/** Kotlin's primitive classes, by the boxed Java class a type argument holds them as. */
const BOXED: Record<string, { kotlin: string; prim: PrimName }> = {
  "java/lang/Boolean": { kotlin: "kotlin/Boolean", prim: "boolean" },
  "java/lang/Byte": { kotlin: "kotlin/Byte", prim: "byte" },
  "java/lang/Character": { kotlin: "kotlin/Char", prim: "char" },
  "java/lang/Short": { kotlin: "kotlin/Short", prim: "short" },
  "java/lang/Integer": { kotlin: "kotlin/Int", prim: "int" },
  "java/lang/Long": { kotlin: "kotlin/Long", prim: "long" },
  "java/lang/Float": { kotlin: "kotlin/Float", prim: "float" },
  "java/lang/Double": { kotlin: "kotlin/Double", prim: "double" },
};

const classOfKotlin = (kt: KotlinType | undefined) =>
  kt && "class" in kt.classifier ? kt.classifier.class : undefined;

/**
 * A type argument Kotlin declares as a primitive (`List<Int>`, `Flow<Boolean>`),
 * which the JVM holds boxed: the number or boolean it is. Java's own
 * `List<Integer>` stays the Integer class.
 */
function boxedAs(kt: KotlinType | undefined, t: JType): SchemaType | undefined {
  const boxed = t.k === "class" ? BOXED[t.name] : undefined;
  if (!boxed || !kt || kt.platform || classOfKotlin(kt) !== boxed.kotlin) return undefined;

  return { k: "prim", name: boxed.prim, nullable: kt.nullable };
}

/**
 * Whether a JVM `java.util.List` is Kotlin's read-only `List` of typed
 * elements: its copy is all a caller can rely on. A MutableList, a list of
 * unknown elements (`List<*>`) and a Java declaration's list (a platform
 * type, mutable or not) are the object itself.
 */
function readOnlyList(t: JType & { k: "class" }, kt: KotlinType | undefined): boolean {
  return (
    t.name === "java/util/List" &&
    t.args.length === 1 &&
    !!kt &&
    !kt.platform &&
    classOfKotlin(kt) === "kotlin/collections/List" &&
    typeArgument(kt, 0) !== undefined
  );
}

/** A Kotlin type's `i`th type argument; undefined for a star projection or none. */
function typeArgument(kt: KotlinType | undefined, i: number): KotlinType | undefined {
  const a = kt?.arguments[i];
  return a && a !== "*" ? a.type : undefined;
}

/**
 * Whether a public JVM method of a Kotlin class that its metadata does not
 * name is one Kotlin generates for Java callers, declared as Java sees it:
 * an enum's statics, the statics of a companion's `@JvmStatic` members,
 * overloads of declarations with defaults (`@JvmOverloads`, the
 * no-argument constructor), and overrides of supertypes' methods (a value
 * class's `toString`). Anything else is internal, or plumbing.
 */
function generatedForJava(
  view: KotlinView,
  internal: string,
  m: MemberInfo,
  classes: Map<string, ClassFile>,
): boolean {
  if (view.overloaded.has(m.name)) return true;
  if (!(m.access & ACC.STATIC)) return !!overriddenMethod(internal, m, classes);

  return view.facts.kind === "enum" || view.bridges.has(m.name + m.descriptor);
}

/**
 * A Kotlin class's properties, read through the accessor methods declared
 * (and typed) with it: writable when a setter is API. Extension properties
 * are their accessors, and properties without accessors their fields.
 */
function kotlinProperties(
  view: KotlinView,
  methods: SdkMethodSchema[],
  declared: SdkPropertySchema[],
): SdkPropertySchema[] {
  const out: SdkPropertySchema[] = [];
  const accessor = (jvm: { name: string; descriptor: string } | undefined) =>
    jvm && methods.find((x) => (x.java ?? x.name) === jvm.name && x.descriptor === jvm.descriptor);

  for (const p of view.properties) {
    const get = accessor(p.getter.jvm);
    if (!get || [...declared, ...out].some((x) => x.name === p.name)) continue;

    const set = accessor(p.setter?.jvm);
    const prop: SdkPropertySchema = {
      name: p.name,
      type: get.returns,
      getter: get.java ?? get.name,
      symbol: get.symbol,
    };

    if (get.static) prop.static = true;
    if (set) prop.setter = set.java ?? set.name;
    else prop.readonly = true;

    // As its getter's.
    if (get.returnsOneOf) prop.oneOf = get.returnsOneOf;
    if (get.facts) prop.facts = get.facts;
    if (get.mainActor !== undefined) prop.mainActor = get.mainActor;
    if (get.worker) prop.worker = get.worker;
    if (get.kotlin?.unboxed) prop.kotlin = { unboxed: true };
    if (get.since) prop.since = get.since;
    if (get.deprecated) prop.deprecated = true;

    out.push(prop);
  }

  return out;
}

/**
 * Where a package's classes come from: the first archive on the classpath
 * that has any (a package split across archives is its first's), for the
 * SDK platform on the classpath.
 */
function androidProvenance(
  pkg: string,
  jars: string[],
  known: Set<string>,
  origins: Map<string, string>,
): SchemaProvenance | undefined {
  const from = new Set([...known].filter((c) => packageOf(c) === pkg).map((c) => origins.get(c)));
  const file = jars.find((j) => from.has(j));
  if (!file) return undefined;

  const { artifact, kind } = jarArtifact(file);
  const target = jars.map((j) => jarArtifact(j).target).find(Boolean) ?? "android";

  return {
    artifact,
    kind,
    contentHash: archiveIndex(file).contentHash,
    target,
    extractor: extractorVersion(),
  };
}

/** A class's public compile-time constants (static final primitives and strings). */
function constantFields(c: ClassFile): MemberInfo[] {
  return c.fields.filter(
    (f) =>
      f.access & ACC.PUBLIC &&
      f.access & ACC.STATIC &&
      f.access & ACC.FINAL &&
      f.constant !== undefined &&
      (typeof f.constant !== "bigint" || Number.isSafeInteger(Number(f.constant))),
  );
}

/**
 * A constant named in an annotation (`android.view.View.AUTOFILL_TYPE_NONE`,
 * nested classes with dots), as `package.Class.FIELD` in Lucent's names;
 * undefined when no visible class has that constant.
 */
function constantRef(
  dotted: string,
  classes: Map<string, ClassFile>,
  known: Set<string>,
): string | undefined {
  const field = dotted.slice(dotted.lastIndexOf(".") + 1);
  const parts = dotted.slice(0, dotted.lastIndexOf(".")).split(".");
  // The package is the leading lowercase segments; the rest are nested classes.
  for (let i = parts.length - 1; i > 0; i--) {
    const internal = `${parts.slice(0, i).join("/")}/${parts.slice(i).join("$")}`;
    const c = classes.get(internal);
    if (!c || !known.has(internal)) continue;
    return constantFields(c).some((f) => f.name === field)
      ? `${refOf(internal)}.${field}`
      : undefined;
  }
  return undefined;
}

/** The annotations.zip an AAR carries next to its classes. */
function aarAnnotations(jars: string[]): ZipArchive[] {
  return jars
    .filter((f) => f.endsWith(".aar"))
    .flatMap((f) => {
      const zip = new ZipArchive(f).read("annotations.zip");
      return zip ? [new ZipArchive(zip)] : [];
    });
}

/**
 * What annotations.zip files (the SDK's, and each AAR's) say about methods:
 * @RequiresPermission, and the constants @IntDef and @StringDef allow
 * (flag groups, which combine, are left out). Keyed `pkg.Class name(params)`
 * with erased parameter types, plus ` N` for parameter N.
 */
function readAnnotations(
  zips: ZipArchive[],
  packages: string[],
  constant: (dotted: string) => string | undefined,
): {
  permissions: Map<string, string[]>;
  oneOf: Map<string, string[]>;
  threads: Map<string, ThreadMark>;
} {
  const permissions = new Map<string, string[]>();
  const oneOf = new Map<string, string[]>();
  const threads = new Map<string, ThreadMark>();
  const unescape = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  for (const zip of zips) {
    for (const pkg of packages) {
      const xml = zip.read(`${pkg.replace(/\./g, "/")}/annotations.xml`)?.toString("utf8");
      if (!xml) continue;
      for (const item of xml.matchAll(/<item name="([^"]*)">([\s\S]*?)<\/item>/g)) {
        const name =
          /<annotation name="androidx\.annotation\.(MainThread|UiThread|WorkerThread|AnyThread)"/.exec(
            item[2]!,
          )?.[1];
        const thread: ThreadMark | undefined = name
          ? { affinity: THREADS[name]!, source: "annotation", detail: `@${name}` }
          : undefined;
        // A class (`pkg.Class`, `pkg.Outer.Inner`): its members, but those annotated themselves.
        if (/^[\w.$]+$/.test(item[1]!)) {
          if (thread) threads.set(item[1]!, thread);
          continue;
        }
        // `pkg.Class ret name(params) N`, `pkg.Class Class(params) N` for constructors.
        const m = /^(\S+) (?:\S+ )?([\w$]+)\((.*)\)(?: (\d+))?$/.exec(
          unescape(item[1]!).replace(/<[^<>]*(?:<[^<>]*>[^<>]*)*>/g, ""),
        );
        if (!m) continue;
        const params = m[3]!
          .split(",")
          .map((p) => p.trim().replace(/\.\.\.$/, "[]"))
          .filter(Boolean);
        const key = `${m[1]} ${m[2]}(${params.join(", ")})`;
        const body = item[2]!;
        if (thread && m[4] === undefined) threads.set(key, thread);
        const perm =
          /<annotation name="androidx\.annotation\.RequiresPermission">([\s\S]*?)<\/annotation>/.exec(
            body,
          );
        if (perm && m[4] === undefined) {
          const names = [
            ...perm[1]!.matchAll(/<val name="(?:value|anyOf|allOf)" val="([^"]*)"/g),
          ].flatMap((v) => [...unescape(v[1]!).matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
          if (names.length) permissions.set(key, names);
        }
        const def =
          /<annotation name="androidx\.annotation\.(?:IntDef|StringDef|LongDef)">([\s\S]*?)<\/annotation>/.exec(
            body,
          );
        if (!def || /<val name="flag" val="true"/.test(def[1]!)) continue;
        const values = /<val name="value" val="\{([^}]*)\}"/.exec(def[1]!)?.[1];
        const refs = values?.split(",").map((v) => constant(v.trim()));
        if (refs?.length && refs.every((r) => r !== undefined))
          oneOf.set(m[4] === undefined ? key : `${key} ${m[4]}`, refs as string[]);
      }
    }
  }
  return { permissions, oneOf, threads };
}

/** Where the thread annotations say a class's or method's code runs. */
const THREADS: Record<string, ThreadMark["affinity"]> = {
  MainThread: "main",
  UiThread: "main",
  AnyThread: "any",
  WorkerThread: "worker",
};

/** A method descriptor's parameters as Java source types (`android.location.Location`). */
function javaParams(descriptor: string): string[] {
  const out: string[] = [];
  let p = 1;
  const one = (): string => {
    const c = descriptor[p++]!;
    if (c === "[") return `${one()}[]`;
    if (c === "L") {
      const end = descriptor.indexOf(";", p);
      const name = descriptor.slice(p, end).replace(/[/$]/g, ".");
      p = end + 1;
      return name;
    }
    return PRIM[c]!;
  };
  while (descriptor[p] !== ")") out.push(one());
  return out;
}

/** Public methods of Object an interface may redeclare: they do not count as abstract. */
const OBJECT_METHODS = new Set([
  "equals(Ljava/lang/Object;)Z",
  "hashCode()I",
  "toString()Ljava/lang/String;",
]);

/** An interface's abstract methods (`name+descriptor`), its superinterfaces' included. */
/** How annotations.zip names a method: `pkg.Class name(param types)`. */
function javaMemberKey(internal: string, m: MemberInfo): string {
  return `${internal.replace(/[/$]/g, ".")} ${m.name}(${javaParams(m.descriptor).join(", ")})`;
}

/**
 * The method `m` of `internal` redeclares: for an instance method, the
 * nearest superclass's or superinterface's with its name and parameters (a
 * covariant override returns another type); for a static, the nearest
 * superclass static it hides.
 */
function overriddenMethod(
  internal: string,
  m: MemberInfo,
  classes: Map<string, ClassFile>,
): { owner: string; method: MemberInfo } | undefined {
  const params = m.descriptor.slice(0, m.descriptor.indexOf(")") + 1);
  const isStatic = !!(m.access & ACC.STATIC);
  const start = classes.get(internal);
  // Interfaces' statics are not inherited: a static hides superclasses' only.
  const next = (c: ClassFile) => [
    ...(c.superName ? [c.superName] : []),
    ...(isStatic ? [] : c.interfaces),
  ];
  const queue = start ? next(start) : [];
  const seen = new Set<string>();

  while (queue.length) {
    const owner = queue.shift()!;
    if (seen.has(owner)) continue;
    seen.add(owner);

    const c = classes.get(owner);
    if (!c) continue;

    const method = c.methods.find(
      (x) =>
        x.name === m.name &&
        x.descriptor.startsWith(params) &&
        !!(x.access & ACC.STATIC) === isStatic &&
        !(x.access & (ACC.PRIVATE | ACC.SYNTHETIC | ACC.BRIDGE)),
    );
    if (method) return { owner, method };

    queue.push(...next(c));
  }

  return undefined;
}

const dotted = (internal: string) => internal.replace(/[/$]/g, ".");

/** The property name a public no-argument getter gives (`getLayout` → `layout`, `isEmpty` → `empty`). */
function getterProperty(m: MemberInfo): string | undefined {
  const getter = /^(get|is)([A-Z].*)$/.exec(m.name);
  if (!getter || !(m.access & ACC.PUBLIC) || m.access & ACC.STATIC) return undefined;

  const ret = m.descriptor.startsWith("()") ? m.descriptor.slice(2) : undefined;
  if (!ret || ret === "V" || (getter[1] === "is" && ret !== "Z")) return undefined;

  return propertyName(getter[2]!);
}

/**
 * What the supertypes of `internal` show TypeScript, by name, the nearest
 * first: their instance methods, and the properties their public fields and
 * getters give (a Kotlin class's come from its metadata: not read here).
 */
function inheritedNames(
  internal: string,
  classes: Map<string, ClassFile>,
  isKotlin: (internal: string) => boolean,
): {
  methods: Set<string>;
  properties: Map<string, { owner: string; from: string }>;
} {
  const methods = new Set<string>();
  const properties = new Map<string, { owner: string; from: string }>();
  const start = classes.get(internal);
  const queue = start ? [...(start.superName ? [start.superName] : []), ...start.interfaces] : [];
  const seen = new Set<string>();

  while (queue.length) {
    const owner = queue.shift()!;
    if (seen.has(owner)) continue;
    seen.add(owner);

    const c = classes.get(owner);
    if (!c) continue;

    const own = c.methods.filter(
      (m) =>
        m.access & ACC.PUBLIC &&
        !(m.access & (ACC.STATIC | ACC.SYNTHETIC | ACC.BRIDGE)) &&
        m.name !== "<init>",
    );
    // A class's own method of a property's name takes it (View's hasOverlappingRendering()).
    const ownNames = new Set(own.map((m) => m.name));

    for (const m of own) {
      methods.add(m.name);

      const property = isKotlin(owner) ? undefined : getterProperty(m);
      if (property && !ownNames.has(property) && !properties.has(property))
        properties.set(property, { owner, from: `${m.name}()` });
    }

    for (const f of c.fields)
      if (
        f.access & ACC.PUBLIC &&
        !(f.access & ACC.STATIC) &&
        !ownNames.has(f.name) &&
        !properties.has(f.name)
      )
        properties.set(f.name, { owner, from: `the field ${f.name}` });

    queue.push(...(c.superName ? [c.superName] : []), ...c.interfaces);
  }

  return { methods, properties };
}

/** The packages of `packages`' classes and of all their supertypes, sorted. */
function packagesAbove(
  packages: readonly string[],
  classes: Map<string, ClassFile>,
  known: Set<string>,
): string[] {
  const wanted = new Set(packages);
  const out = new Set(packages);
  const seen = new Set<string>();
  const pending = [...known].filter((k) => wanted.has(packageOf(k)));

  while (pending.length) {
    const internal = pending.pop()!;
    if (seen.has(internal)) continue;
    seen.add(internal);

    const c = classes.get(internal);
    if (!c) continue;

    for (const sup of [...(c.superName ? [c.superName] : []), ...c.interfaces]) {
      out.add(packageOf(sup));
      pending.push(sup);
    }
  }

  return [...out].sort();
}

function abstractMethods(
  internal: string,
  classes: Map<string, ClassFile>,
  seen = new Set<string>(),
): string[] {
  const c = classes.get(internal);
  if (!c || seen.has(internal)) return [];
  seen.add(internal);
  const own = c.methods
    .filter((m) => m.access & ACC.ABSTRACT && !(m.access & ACC.STATIC))
    .map((m) => `${m.name}${m.descriptor}`);
  // A superinterface's abstract method this interface implements with a default is not abstract here.
  const defaults = new Set(
    c.methods.filter((m) => !(m.access & ACC.ABSTRACT)).map((m) => `${m.name}${m.descriptor}`),
  );
  const inherited = c.interfaces
    .flatMap((i) => abstractMethods(i, classes, seen))
    .filter((m) => !defaults.has(m));
  return [...new Set([...own, ...inherited])].filter((m) => !OBJECT_METHODS.has(m));
}

/** What TypeScript sees of a parameter list: overloads that map to the same one collide. */
function tsKey(m: SdkMethodSchema): string {
  const one = (t: string): string => {
    const base = t.replace(/\?$/, "");
    if (base.endsWith("[]")) return `${one(base.slice(0, -2))}[]`;
    if (["byte", "char", "short", "int", "long", "float", "double"].includes(base)) return "number";
    return base;
  };
  return `${m.static ? "static " : ""}${m.name}(${m.params.map((p) => one(formatSchemaType(p.type))).join(",")})`;
}

// Which overload a JavaScript number picks when several collide: int first.
const NUMBER_RANK: Record<string, number> = {
  int: 0,
  long: 1,
  double: 2,
  float: 3,
  short: 4,
  byte: 5,
  char: 6,
};
const rank = (m: SdkMethodSchema) =>
  m.params.map((p) => NUMBER_RANK[formatSchemaType(p.type)] ?? 0);
const before = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

/**
 * In an interface, default methods that overload an abstract one get their
 * parameter types in their names (onLocationChanged(List) →
 * onLocationChanged_List): a class implementing the abstract method then
 * implements nothing else.
 */
function renameDefaultOverloads(methods: SdkMethodSchema[]): void {
  const abstractNames = new Set(methods.filter((m) => m.abstract && !m.static).map((m) => m.name));
  for (const m of methods) {
    if (m.abstract || m.static || !abstractNames.has(m.name)) continue;
    m.java = m.java ?? m.name;
    m.name = overloadName(m);
  }
}

/** A renamed overload's name: its parameters' simple types, without type arguments. */
function overloadName(m: SdkMethodSchema): string {
  const simple = (t: SchemaType) =>
    formatSchemaType(t)
      .replace(/<.*>/, "")
      .replace(/\?$/, "")
      .replace(/\[\]/g, "Array")
      .split(".")
      .pop();
  return `${m.java ?? m.name}_${m.params.map((p) => simple(p.type)).join("_")}`;
}

function renameOverloads(methods: SdkMethodSchema[]): void {
  const keepers = new Map<string, SdkMethodSchema>();
  for (const m of methods) {
    const key = tsKey(m);
    const k = keepers.get(key);
    if (!k || before(rank(m), rank(k))) keepers.set(key, m);
  }
  const seen = new Set(keepers.keys());
  for (const m of methods) {
    if (keepers.get(tsKey(m)) === m) continue;
    const javaName = m.name;
    m.name = overloadName(m);
    m.java = m.java ?? javaName;
    seen.add(tsKey(m));
  }
}
