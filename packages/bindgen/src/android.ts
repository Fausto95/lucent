import fs from "node:fs";
import type { SdkCallable, SdkClassSchema, SdkMethodSchema, SdkModuleSchema, SdkPropertySchema } from "./schema.ts";
import { ACC, type ClassFile, type MemberInfo, parseClass } from "./classfile.ts";
import { ZipArchive } from "./zip.ts";

/**
 * Binding schemas for Java packages, read from class files (android.jar, and
 * the jars inside AARs). Nullability comes from annotations (unannotated
 * references are nullable), API levels from the SDK's api-versions.xml.
 */
export interface AndroidOptions {
  jars: string[];
  /** The SDK's platforms/android-N/data/api-versions.xml. */
  apiVersions?: string;
  /** Java packages to extract; references to classes outside them are not typed. */
  packages: string[];
}

const NON_NULL = new Set(["Landroid/annotation/NonNull;", "Landroidx/annotation/NonNull;", "Landroidx/annotation/RecentlyNonNull;", "Lorg/jetbrains/annotations/NotNull;", "Ljavax/annotation/Nonnull;", "Llibcore/util/NonNull;"]);

const PRIM: Record<string, string> = { Z: "boolean", B: "byte", C: "char", S: "short", I: "int", J: "long", F: "float", D: "double", V: "void" };

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
  constructor(readonly s: string) {}
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

const packageOf = (internal: string) => internal.slice(0, internal.lastIndexOf("/")).replace(/\//g, ".");
const simpleOf = (internal: string) => internal.slice(internal.lastIndexOf("/") + 1).replace(/\$/g, "_");
const refOf = (internal: string) => `${packageOf(internal)}.${simpleOf(internal)}`;

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
  known: Set<string>;
  nestedAccess: Map<string, number>;
  /** Java packages with at least one visible class. */
  packages: Set<string>;
  levels: ApiLevels;
}

const jarIndexes = new Map<string, JarIndex>();

/** Reads all classes of `jars` (once per process per identity: a few hundred ms for android.jar). */
export function jarIndex(jars: string[], apiVersions: string | undefined): JarIndex {
  const identity = [...jars, apiVersions ?? ""].map((f) => (f && fs.existsSync(f) ? `${f}:${fs.statSync(f).size}:${fs.statSync(f).mtimeMs}` : f)).join("|");
  const cached = jarIndexes.get(identity);
  if (cached) return cached;
  const classes = new Map<string, ClassFile>();
  // AARs carry their classes in classes.jar (and libs/*.jar).
  const archives = jars.flatMap((file): ZipArchive[] => {
    const zip = new ZipArchive(file);
    if (!file.endsWith(".aar")) return [zip];
    return zip.names().filter((n) => n === "classes.jar" || /^libs\/[^/]+\.jar$/.test(n)).map((n) => new ZipArchive(zip.read(n)!));
  });
  for (const zip of archives) {
    for (const entry of zip.names()) {
      if (!entry.endsWith(".class") || entry.includes("-") || entry.startsWith("META-INF/")) continue;
      const internal = entry.slice(0, -".class".length);
      // The first jar on the classpath wins, as in the class loader.
      if (!classes.has(internal)) classes.set(internal, parseClass(zip.read(entry)!));
    }
  }
  // Public top-level classes, and public nested classes of public classes.
  const nestedAccess = new Map<string, number>();
  for (const c of classes.values()) for (const ic of c.innerClasses) if (ic.inner === c.name) nestedAccess.set(c.name, ic.access);
  const visible = (internal: string): boolean => {
    const c = classes.get(internal);
    if (!c || c.access & ACC.SYNTHETIC || c.access & ACC.ANNOTATION) return false;
    if (!internal.includes("$")) return !!(c.access & ACC.PUBLIC);
    const access = nestedAccess.get(internal);
    if (access === undefined || !(access & ACC.PUBLIC) || /\$\d/.test(internal)) return false;
    return visible(internal.slice(0, internal.lastIndexOf("$")));
  };
  const known = new Set([...classes.keys()].filter(visible));
  const index: JarIndex = { classes, known, nestedAccess, packages: new Set([...known].map(packageOf)), levels: readApiLevels(apiVersions) };
  jarIndexes.set(identity, index);
  return index;
}

export function extractAndroid(opts: AndroidOptions): SdkModuleSchema[] {
  const { classes, known, nestedAccess, levels } = jarIndex(opts.jars, opts.apiVersions);

  const modules = new Map<string, SdkModuleSchema>();
  for (const pkg of opts.packages) modules.set(pkg, { platform: "android", module: pkg, types: [], skipped: [] });

  for (const internal of [...known].sort()) {
    const mod = modules.get(packageOf(internal));
    if (!mod) continue;
    const c = classes.get(internal)!;
    const isInterface = !!(c.access & ACC.INTERFACE);
    const innerClass = internal.includes("$") && !((nestedAccess.get(internal) ?? 0) & ACC.STATIC) && !isInterface;
    const cls: SdkClassSchema = { kind: "class", name: simpleOf(internal), native: internal };
    if (c.superName && c.superName !== "java/lang/Object" && known.has(c.superName)) cls.extends = refOf(c.superName);
    const ifaces = c.interfaces.filter((i) => known.has(i)).map(refOf);
    if (ifaces.length) cls.implements = ifaces;
    if (isInterface) cls.interface = true;
    else if (c.access & ACC.ABSTRACT) cls.abstract = true;
    const since = levels.cls.get(internal);
    if (since && since > 1) cls.since = since;

    const skip = (m: MemberInfo, reason: string) => mod.skipped!.push(`${internal.replace(/\//g, ".")}.${m.name}${m.descriptor}: ${reason}`);

    const typeOf = (t: JType, nonNull: boolean, tparams: readonly string[]): string => {
      const nullable = (s: string) => (nonNull ? s : `${s}?`);
      switch (t.k) {
        case "prim":
          return PRIM[t.d]!;
        case "array": {
          const inner = typeOf(t.of, true, tparams);
          if (inner.endsWith("?")) throw new Unsupported("nullable array element");
          return nullable(`${inner}[]`);
        }
        case "var":
          if (!tparams.includes(t.name)) throw new Unsupported(`type variable ${t.name}`);
          return nullable(t.name);
        case "wildcard":
          throw new Unsupported("wildcard");
        case "class":
          if (t.name === "java/lang/String") return nullable("string");
          if (t.name === "java/lang/CharSequence") return nullable("CharSequence");
          if (t.name === "java/lang/Class") {
            const arg = t.args[0];
            if (arg?.k === "var" && tparams.includes(arg.name)) return nullable(`Class<${arg.name}>`);
            throw new Unsupported("java.lang.Class");
          }
          if (!known.has(t.name)) throw new Unsupported(t.name.replace(/\//g, "."));
          return nullable(refOf(t.name));
      }
    };
    const nonNull = (anns: string[] | undefined) => !!anns?.some((a) => NON_NULL.has(a));

    const props: SdkPropertySchema[] = [];
    for (const f of c.fields) {
      if (!(f.access & ACC.PUBLIC) || f.access & ACC.SYNTHETIC) continue;
      let type: string;
      try {
        type = typeOf(new SigReader(f.signature ?? f.descriptor).type(), nonNull(f.annotations), []);
      } catch (e) {
        if (e instanceof Unsupported) {
          skip(f, e.message);
          continue;
        }
        throw e;
      }
      const p: SdkPropertySchema = { name: f.name, type };
      if (f.access & ACC.STATIC) p.static = true;
      p.readonly = !!(f.access & ACC.FINAL);
      if (f.access & ACC.STATIC && f.access & ACC.FINAL && f.constant !== undefined) {
        p.value = type === "boolean" ? f.constant === 1 : f.constant;
        if (typeof p.value === "string") p.type = "string";
      }
      const fs = levels.member.get(`${internal}#${f.name}`);
      if (fs && fs > (cls.since as number | undefined ?? 1)) p.since = fs;
      if (f.deprecated) p.deprecated = true;
      props.push(p);
    }

    const ctors: SdkCallable[] = [];
    const methods: SdkMethodSchema[] = [];
    for (const m of [...c.methods].sort((a, b) => (a.name === b.name ? (a.descriptor < b.descriptor ? -1 : 1) : a.name < b.name ? -1 : 1))) {
      if (!(m.access & ACC.PUBLIC) || m.access & (ACC.SYNTHETIC | ACC.BRIDGE) || m.name === "<clinit>") continue;
      if (m.name === "<init>" && (isInterface || cls.abstract || innerClass)) continue;
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
      let params: { name: string; type: string }[];
      let returns: string;
      try {
        params = sig.params.map((t, i) => ({ name: `arg${i}`, type: typeOf(t, nonNull(m.paramAnnotations[i]), sig.typeParams) }));
        returns = typeOf(sig.ret, nonNull(m.annotations), sig.typeParams);
      } catch (e) {
        if (e instanceof Unsupported) {
          skip(m, e.message);
          continue;
        }
        throw e;
      }
      const ms = levels.member.get(`${internal}#${m.name}${m.descriptor}`);
      const since = ms && ms > (cls.since as number | undefined ?? 1) ? ms : undefined;
      if (m.name === "<init>") {
        const ctor: SdkCallable = { params, descriptor: m.descriptor };
        if (since) ctor.since = since;
        if (m.deprecated) ctor.deprecated = true;
        ctors.push(ctor);
        continue;
      }
      const method: SdkMethodSchema = { name: m.name, params, returns, descriptor: m.descriptor };
      if (m.access & ACC.STATIC) method.static = true;
      if (m.access & ACC.ABSTRACT) method.abstract = true;
      if (sig.typeParams.length) method.typeParams = sig.typeParams;
      if (since) method.since = since;
      if (m.deprecated) method.deprecated = true;
      methods.push(method);

      // Kotlin-style properties for getters.
      const getter = /^(get|is)([A-Z].*)$/.exec(m.name);
      if (getter && !method.static && !params.length && returns !== "void" && (getter[1] === "get" || returns === "boolean")) {
        const name = propertyName(getter[2]!);
        if (!props.some((p) => p.name === name)) {
          const p: SdkPropertySchema = { name, readonly: true, getter: m.name, type: returns };
          if (since) p.since = since;
          props.push(p);
        }
      }
    }
    renameOverloads(methods);
    if (isInterface) renameDefaultOverloads(methods);
    if (isInterface) {
      // Java's rule for what a lambda implements: one abstract method, inherited ones counted.
      const abstract = abstractMethods(internal, classes);
      const only = abstract.length === 1 ? methods.find((x) => x.abstract && `${x.java ?? x.name}${x.descriptor}` === abstract[0]) : undefined;
      if (only) cls.functional = only.name;
    }

    if (ctors.length) cls.constructors = ctors;
    if (methods.length) cls.methods = methods;
    if (props.length) cls.properties = props;
    mod.types.push(cls);
  }
  return [...modules.values()];
}

/** Public methods of Object an interface may redeclare: they do not count as abstract. */
const OBJECT_METHODS = new Set(["equals(Ljava/lang/Object;)Z", "hashCode()I", "toString()Ljava/lang/String;"]);

/** An interface's abstract methods (`name+descriptor`), its superinterfaces' included. */
function abstractMethods(internal: string, classes: Map<string, ClassFile>, seen = new Set<string>()): string[] {
  const c = classes.get(internal);
  if (!c || seen.has(internal)) return [];
  seen.add(internal);
  const own = c.methods.filter((m) => m.access & ACC.ABSTRACT && !(m.access & ACC.STATIC)).map((m) => `${m.name}${m.descriptor}`);
  // A superinterface's abstract method this interface implements with a default is not abstract here.
  const defaults = new Set(c.methods.filter((m) => !(m.access & ACC.ABSTRACT)).map((m) => `${m.name}${m.descriptor}`));
  const inherited = c.interfaces.flatMap((i) => abstractMethods(i, classes, seen)).filter((m) => !defaults.has(m));
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
  return `${m.static ? "static " : ""}${m.name}(${m.params.map((p) => one(p.type)).join(",")})`;
}

// Which overload a JavaScript number picks when several collide: int first.
const NUMBER_RANK: Record<string, number> = { int: 0, long: 1, double: 2, float: 3, short: 4, byte: 5, char: 6 };
const rank = (m: SdkMethodSchema) => m.params.map((p) => NUMBER_RANK[p.type] ?? 0);
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

function overloadName(m: SdkMethodSchema): string {
  return `${m.java ?? m.name}_${m.params.map((p) => p.type.replace(/\?$/, "").replace(/\[\]/g, "Array").split(".").pop()).join("_")}`;
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
    m.java = javaName;
    seen.add(tsKey(m));
  }
}
