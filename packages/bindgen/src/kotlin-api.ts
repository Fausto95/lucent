/**
 * Binding schemas of Kotlin libraries whose API is called from generated
 * Kotlin source, never over JNI (Jetpack Compose, for components' content):
 * their Kotlin metadata is the whole declaration, as a Kotlin caller sees
 * it, without the JVM typing android.ts gives libraries JNI calls. A
 * composable's JVM method, for one, takes a Composer that its source call
 * never passes.
 *
 * Class files add what the metadata leaves to annotations: a composable
 * function (`@Composable`), the UI it emits (the applier its
 * `@ComposableTarget`, `@ComposableInferredTarget` or a target's marker
 * annotation, `@UiComposable`, names), a deprecation's level, and the
 * opt-in an experimental API requires.
 *
 * Classes the API names from the libraries' dependencies (a coroutine
 * scope) are declared without members: values of them pass through.
 * Packages named `internal` are left out: AndroidX keeps its libraries'
 * own public classes there.
 */
import { type ClassFile, parseClass } from "./classfile.ts";
import type {
  KotlinClass,
  KotlinDeclaration,
  KotlinFunction,
  KotlinProperty,
  KotlinType,
  KotlinTypeParameter,
  KotlinValueParameter,
} from "./kotlin-metadata.ts";
import { kotlinDeclaration, readMetadataHeader } from "./kotlin-metadata-reader.ts";
import { extractorVersion, jarArtifact, jvmSymbol } from "./provenance.ts";
import {
  formatSchemaType,
  type KotlinMemberFacts,
  type KotlinParamFacts,
  type PrimName,
  SCHEMA_FORMAT,
  type SchemaType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
} from "./schema.ts";
import { ZipArchive } from "./zip.ts";

export interface KotlinApiOptions {
  /** The libraries whose Kotlin packages are bound: jars or AARs. */
  libraries: string[];
  /** What they depend on: jars or AARs whose classes their API may name. */
  classpath?: string[];
  /** What the declarations are read for, as provenance names it: `android-35`. */
  target: string;
}

/** Compose's annotations, by class file descriptor: the facts their compiler plugin acts on. */
const COMPOSE = {
  composable: "Landroidx/compose/runtime/Composable;",
  target: "Landroidx/compose/runtime/ComposableTarget;",
  inferredTarget: "Landroidx/compose/runtime/ComposableInferredTarget;",
  /** On an annotation class standing for a target (`@UiComposable`): the applier is its name. */
  targetMarker: "Landroidx/compose/runtime/ComposableTargetMarker;",
  /** A type annotation on function types, as Kotlin names classes. */
  composableType: "androidx/compose/runtime/Composable",
} as const;

const DEPRECATED = "Lkotlin/Deprecated;";
const REQUIRES_OPT_IN = "Lkotlin/RequiresOptIn;";
const RESTRICT_TO = "Landroidx/annotation/RestrictTo;";
const EXTENSION_FUNCTION_TYPE = "kotlin/ExtensionFunctionType";

class Unsupported extends Error {}

/** A class file of the classpath, read when first needed. */
interface Entry {
  zip: ZipArchive;
  name: string;
  /** Whether it is one of the bound libraries' (else a dependency's). */
  bound: boolean;
  library: string;
  parsed?: ClassFile;
  declaration?: KotlinDeclaration | null;
}

/** The schemas of every Kotlin package the libraries declare API in, and of the dependencies' classes they name. */
export function extractKotlinApi(opts: KotlinApiOptions): SdkModuleSchema[] {
  const index = new Map<string, Entry>();

  for (const [bound, files] of [
    [true, opts.libraries],
    [false, opts.classpath ?? []],
  ] as const)
    for (const file of files)
      for (const zip of archives(file))
        for (const name of zip.names()) {
          if (!name.endsWith(".class") || name.startsWith("META-INF/")) continue;

          const internal = name.slice(0, -".class".length);
          // The first on the classpath wins, as in the class loader.
          if (!index.has(internal)) index.set(internal, { zip, name, bound, library: file });
        }

  const classFile = (internal: string): ClassFile | undefined => {
    const e = index.get(internal);
    if (!e) return undefined;

    e.parsed ??= parseClass(e.zip.read(e.name)!);
    return e.parsed;
  };

  const declaration = (internal: string): KotlinDeclaration | undefined => {
    const e = index.get(internal);
    if (!e) return undefined;

    if (e.declaration === undefined) {
      const header = readMetadataHeader(e.zip.read(e.name)!);
      e.declaration = (header && kotlinDeclaration(header)) ?? null;
    }

    return e.declaration ?? undefined;
  };

  /** Whether an annotation (a descriptor) is itself annotated with `meta` (its class says so). */
  const metaAnnotated = new Map<string, boolean>();
  const annotatedWith = (descriptor: string, meta: string): boolean => {
    const key = `${descriptor} ${meta}`;
    let known = metaAnnotated.get(key);
    if (known === undefined) {
      known = !!classFile(descriptor.slice(1, -1))?.annotations.includes(meta);
      metaAnnotated.set(key, known);
    }

    return known;
  };

  /** Whether an annotation marks an API that callers opt in to. */
  const isOptInMarker = (descriptor: string) => annotatedWith(descriptor, REQUIRES_OPT_IN);

  const modules = new Map<string, SdkModuleSchema>();
  const moduleOf = (pkg: string, library: string): SdkModuleSchema => {
    let m = modules.get(pkg);
    if (!m) {
      const { artifact, kind } = jarArtifact(library);
      m = {
        format: SCHEMA_FORMAT,
        platform: "android",
        form: "source",
        module: pkg,
        provenance: { artifact, kind, target: opts.target, extractor: extractorVersion() },
        types: [],
        functions: [],
        constants: [],
        skipped: [],
      };
      modules.set(pkg, m);
    }

    return m;
  };

  /** Classes of the dependencies the API names, declared without members. */
  const named = new Set<string>();
  /** Classes that are the receiver of a lambda parameter: content and effects run in them. */
  const scopes = new Set<string>();

  const types = (tparams: ReadonlyMap<number, string>) =>
    new TypeReader(tparams, (kotlinName) => {
      const internal = internalOf(kotlinName, index);
      if (!internal)
        throw new Unsupported(`refers to ${dotted(kotlinName)}, which content does not declare`);
      if (!index.get(internal)!.bound) named.add(internal);
      return refOf(kotlinName);
    });

  // --- members ---

  /** The JVM method of a member, in its class file (its annotations are there). */
  const jvmMethod = (
    owner: ClassFile | undefined,
    jvm: { name: string; descriptor: string } | undefined,
  ) =>
    (jvm && owner?.methods.find((m) => m.name === jvm.name && m.descriptor === jvm.descriptor)) ||
    undefined;

  /**
   * The facts a member's JVM method and class annotations add; `hidden`
   * for a declaration Kotlin callers cannot see, the reason when they
   * cannot call it.
   */
  const annotated = (
    owner: ClassFile | undefined,
    method: ClassFile["methods"][number] | undefined,
  ): { facts: KotlinMemberFacts; deprecated?: boolean; refused?: string; hidden?: boolean } => {
    const anns = method?.annotations ?? [];
    const values = method?.annotationValues ?? {};
    const facts: KotlinMemberFacts = {};

    if (anns.includes(COMPOSE.composable)) facts.composable = true;

    const marker = anns.find((a) => annotatedWith(a, COMPOSE.targetMarker));
    const applier =
      values[COMPOSE.target]?.applier ??
      ownApplier(values[COMPOSE.inferredTarget]?.scheme) ??
      (marker && marker.slice(1, -1).replaceAll("/", "."));
    if (applier) facts.applier = applier;

    const optIn = [...anns, ...(owner?.annotations ?? [])].filter(isOptInMarker);
    if (optIn.length) facts.optIn = [...new Set(optIn.map((d) => d.slice(1, -1)))];

    if (anns.includes(RESTRICT_TO) || owner?.annotations.includes(RESTRICT_TO))
      facts.restricted = true;

    if (!anns.includes(DEPRECATED)) return { facts };

    const level = values[DEPRECATED]?.level ?? "WARNING";
    if (level === "HIDDEN") return { facts, hidden: true };
    if (level === "ERROR")
      return { facts, refused: "deprecated at level ERROR: Kotlin refuses calls to it" };

    return { facts, deprecated: true };
  };

  /**
   * A function's parameters, and the defaulted ones left out: those of a
   * type content cannot write, which Kotlin gives their defaults. A value
   * `x` with a callback `onXChange` taking one of its type is paired: one
   * signal gives both (lucent:ui's bind).
   */
  const params = (
    ps: readonly KotlinValueParameter[],
    reader: TypeReader,
  ): { params: SdkParam[]; omits: string[] } => {
    const omits: string[] = [];
    const out = ps.flatMap((p): SdkParam[] => {
      const facts: KotlinParamFacts = {};
      if (p.declaresDefault) facts.default = true;
      if (p.vararg) facts.vararg = true;

      try {
        const fn = reader.lambda(p.type);
        if (fn) {
          facts.role = fn.composable ? "content" : "callback";
          if (fn.receiver) {
            facts.receiver = fn.receiver;
            if (fn.receiver.k === "ref") scopes.add(`${fn.receiver.module}.${fn.receiver.name}`);
          }
          if (fn.suspend) facts.suspendFunction = true;
        }

        return [
          {
            name: p.name,
            type: fn ? fn.type : reader.type(p.vararg ?? p.type),
            ...(Object.keys(facts).length ? { kotlin: facts } : {}),
          },
        ];
      } catch (e) {
        if (!(e instanceof Unsupported) || !p.declaresDefault || p.vararg) throw e;
        omits.push(p.name);
        return [];
      }
    });

    for (const value of out) {
      const change = out.find(
        (c) =>
          c.name === `on${value.name[0]!.toUpperCase()}${value.name.slice(1)}Change` &&
          c.kotlin?.role === "callback" &&
          c.type.k === "fn" &&
          c.type.params.length === 1 &&
          sameType(c.type.params[0]!, value.type),
      );
      if (change) value.kotlin = { ...value.kotlin, changedBy: change.name };
    }

    return { params: out, omits };
  };

  const typeParams = (
    outer: ReadonlyMap<number, string>,
    own: readonly KotlinTypeParameter[],
  ): Map<number, string> => new Map([...outer, ...own.map((t) => [t.id, t.name] as const)]);

  const fn = (
    f: KotlinFunction,
    owner: ClassFile | undefined,
    scope: ReadonlyMap<number, string>,
    skip: (reason: string) => void,
    overloads: ReadonlyMap<string, readonly string[]>,
  ): SdkMethodSchema | undefined => {
    const a = annotated(owner, jvmMethod(owner, f.jvm));
    if (a.hidden) return undefined;
    if (a.refused) return (skip(a.refused), undefined);
    if (f.contextParameters?.length) return (skip("context parameters"), undefined);

    const reader = types(typeParams(scope, f.typeParameters));
    try {
      const receiver = f.receiver
        ? [{ name: "receiver", type: reader.type(f.receiver) } satisfies SdkParam]
        : [];
      const reified = f.typeParameters.filter((t) => t.reified).map((t) => t.name);
      // Left empty, its vararg would call another overload (one Kotlin refuses, or its own).
      const shadowed =
        f.parameters.some((p) => p.vararg) &&
        (overloads.get(f.name) ?? []).includes(shapeOf(f, false));
      const given = params(f.parameters, reader);
      const facts: KotlinMemberFacts = {
        ...a.facts,
        ...(given.omits.length ? { omits: given.omits } : {}),
        ...(shadowed ? { varargShadowed: true } : {}),
        ...(f.suspend ? { suspend: true } : {}),
        ...(f.receiver ? { extension: true } : {}),
        ...(f.inline ? { inline: true } : {}),
        ...(reified.length ? { reified } : {}),
      };

      return {
        name: f.name,
        params: [...receiver, ...given.params],
        returns: reader.type(f.returnType),
        ...(f.jvm ? { descriptor: f.jvm.descriptor } : {}),
        ...(f.typeParameters.length ? { typeParams: f.typeParameters.map((t) => t.name) } : {}),
        ...(Object.keys(facts).length ? { kotlin: facts } : {}),
        ...(a.deprecated ? { deprecated: true } : {}),
      };
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      skip(e.message);
      return undefined;
    }
  };

  /**
   * A property; an extension property is a function of its receiver
   * (`Int.dp`, called `dp(20)` and written `20.dp`), as its getter is.
   */
  const property = (
    p: KotlinProperty,
    owner: ClassFile | undefined,
    scope: ReadonlyMap<number, string>,
    skip: (reason: string) => void,
  ): SdkPropertySchema | SdkMethodSchema | undefined => {
    const a = annotated(owner, jvmMethod(owner, p.getter.jvm));
    if (a.hidden) return undefined;
    if (a.refused) return (skip(a.refused), undefined);
    if (p.contextParameters?.length) return (skip("context parameters"), undefined);

    const reader = types(typeParams(scope, p.typeParameters));
    try {
      const facts: KotlinMemberFacts = {
        ...a.facts,
        ...(p.receiver ? { extension: true, property: true } : {}),
        ...(p.getter.inline ? { inline: true } : {}),
      };
      const meta = {
        ...(Object.keys(facts).length ? { kotlin: facts } : {}),
        ...(a.deprecated ? { deprecated: true } : {}),
      };

      if (p.receiver)
        return {
          name: p.name,
          params: [{ name: "receiver", type: reader.type(p.receiver) }],
          returns: reader.type(p.type),
          ...(p.getter.jvm ? { descriptor: p.getter.jvm.descriptor } : {}),
          ...(p.typeParameters.length ? { typeParams: p.typeParameters.map((t) => t.name) } : {}),
          ...meta,
        };

      if (p.typeParameters.length) return (skip("a generic property"), undefined);

      return {
        name: p.name,
        type: reader.type(p.type),
        ...(p.setter ? {} : { readonly: true }),
        ...meta,
      };
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      skip(e.message);
      return undefined;
    }
  };

  // --- declarations ---

  /** Every top-level function's shape by package and name, refused and hidden ones too. */
  const byPackage = new Map<string, KotlinFunction[]>();
  for (const [internal, entry] of index) {
    if (!entry.bound) continue;

    const d = declaration(internal);
    if (d?.metadataKind !== "file-facade" && d?.metadataKind !== "multi-file-part") continue;

    const pkg = packageOf(internal);
    byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), ...d.functions]);
  }
  const packageShapes = new Map<string, ReadonlyMap<string, readonly string[]>>();
  const packageOverloads = (pkg: string) => {
    let shapes = packageShapes.get(pkg);
    if (!shapes) packageShapes.set(pkg, (shapes = overloadShapes(byPackage.get(pkg) ?? [])));
    return shapes;
  };

  const skipper = (module: SdkModuleSchema, display: string) => (reason: string) =>
    module.skipped!.push(`${display}: ${reason}`);

  for (const [internal, entry] of [...index].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // An `internal` package is its library's own (AndroidX's convention), whatever Kotlin says.
    if (!entry.bound || /(^|\/)internal\//.test(internal)) continue;

    const d = declaration(internal);
    if (!d) continue;

    if (d.metadataKind === "file-facade" || d.metadataKind === "multi-file-part") {
      const pkg = packageOf(internal);
      const module = moduleOf(pkg, entry.library);
      const owner = classFile(internal);

      for (const f of d.functions) {
        const m = fn(
          f,
          owner,
          new Map(),
          skipper(module, `${pkg}.${f.name}`),
          packageOverloads(pkg),
        );
        if (m)
          module.functions!.push({
            ...m,
            symbol: jvmSymbol(internal, `${f.jvm?.name}${f.jvm?.descriptor}`),
          });
      }

      for (const p of d.properties) {
        const x = property(p, owner, new Map(), skipper(module, `${pkg}.${p.name}`));
        const symbol = jvmSymbol(internal, `${p.getter.jvm?.name}${p.getter.jvm?.descriptor}`);
        if (x && "params" in x) module.functions!.push({ ...x, symbol });
        else if (x) module.constants!.push({ ...x, symbol });
      }

      continue;
    }

    if (d.metadataKind !== "class" || d.kind === "companion" || d.kind === "enum-entry") continue;
    if (d.kind === "annotation") continue;
    // Nested in a class that is not API: not API either.
    if (!outersVisible(d.name, declaration)) continue;

    const pkg = packageOf(d.name);
    const module = moduleOf(pkg, entry.library);
    const cls = klass(d, internal);
    module.types.push(cls);
  }

  function klass(c: KotlinClass, internal: string): SdkClassSchema {
    const module = modules.get(packageOf(c.name))!;
    const own = new Map(c.typeParameters.map((t) => [t.id, t.name] as const));
    const reader = types(own);
    const file = classFile(internal);
    const name = simpleOf(c.name);
    const skip = (member: string) => skipper(module, `${dotted(c.name)}.${member}`);

    const cls: SdkClassSchema = {
      kind: "class",
      name,
      native: internal,
      symbol: jvmSymbol(internal),
      kotlin: { kind: c.kind === "enum-entry" ? "class" : c.kind },
    };
    if (c.kind === "interface") cls.interface = true;
    if (c.modality === "abstract" || c.modality === "sealed") cls.abstract = true;
    if (c.typeParameters.length) cls.typeParams = c.typeParameters.map((t) => t.name);
    if (c.data) cls.kotlin!.data = true;
    if (c.fun) cls.kotlin!.fun = true;

    // Supertypes a Lucent type can name.
    const supers: string[] = [];
    for (const s of c.supertypes) {
      if ("class" in s.classifier && s.classifier.class === "kotlin/Any") continue;
      try {
        const t = reader.type(s);
        if (t.k === "ref") supers.push(formatSchemaType(t));
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
      }
    }
    if (supers.length) cls.implements = supers;

    if (c.valueClass) {
      try {
        cls.kotlin!.value = {
          property: c.valueClass.property,
          type: reader.type(c.valueClass.type),
        };
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
      }
    }

    const ctors: SdkCallable[] = [];
    if (c.kind === "class" && c.modality !== "abstract" && c.modality !== "sealed")
      for (const k of c.constructors) {
        if (k.visibility !== "public") continue;

        const a = annotated(file, jvmMethod(file, k.jvm));
        if (a.hidden) continue;
        if (a.refused) {
          skip("<init>")(a.refused);
          continue;
        }

        try {
          const given = params(k.parameters, reader);
          const facts = { ...a.facts, ...(given.omits.length ? { omits: given.omits } : {}) };

          ctors.push({
            params: given.params,
            ...(k.jvm
              ? {
                  descriptor: k.jvm.descriptor,
                  symbol: jvmSymbol(internal, `${k.jvm.name}${k.jvm.descriptor}`),
                }
              : {}),
            ...(Object.keys(facts).length ? { kotlin: facts } : {}),
            ...(a.deprecated ? { deprecated: true } : {}),
          });
        } catch (e) {
          if (!(e instanceof Unsupported)) throw e;
          skip("<init>")(e.message);
        }
      }
    if (ctors.length) cls.constructors = ctors;

    const methods: SdkMethodSchema[] = [];
    const props: SdkPropertySchema[] = [];
    const members = (
      of: { functions: KotlinFunction[]; properties: KotlinProperty[] },
      owner: ClassFile | undefined,
      ownerInternal: string,
      statics: boolean,
    ) => {
      const overloads = overloadShapes(of.functions);

      for (const f of of.functions) {
        if (f.memberKind === "fake-override" || f.memberKind === "delegation") continue;
        if (ANY_MEMBERS.has(f.name) || /^component\d+$/.test(f.name)) continue;

        const m = fn(f, owner, own, skip(f.name), overloads);
        if (m)
          methods.push({
            ...m,
            symbol: jvmSymbol(ownerInternal, `${f.jvm?.name}${f.jvm?.descriptor}`),
            ...(statics ? { static: true } : {}),
            ...(f.modality === "abstract" ? { abstract: true } : {}),
          });
      }

      for (const p of of.properties) {
        if (p.memberKind === "fake-override" || p.memberKind === "delegation") continue;

        const x = property(p, owner, statics ? new Map() : own, skip(p.name));
        const member = {
          symbol: jvmSymbol(ownerInternal, `${p.getter.jvm?.name}${p.getter.jvm?.descriptor}`),
          ...(statics ? { static: true } : {}),
        };
        if (x && "params" in x) methods.push({ ...x, ...member });
        else if (x) props.push({ ...x, ...member });
      }
    };

    // An object's members are called on its name, as a companion's are on its class's.
    members(c, file, internal, c.kind === "object");

    if (c.companionObject) {
      const companionInternal = `${internal}$${c.companionObject}`;
      const companion = declaration(companionInternal);
      if (companion?.metadataKind === "class") {
        members(companion, classFile(companionInternal), companionInternal, true);

        // `Modifier` names its companion, which is a Modifier: the name is a value of the class's type.
        if (
          companion.supertypes.some((s) => "class" in s.classifier && s.classifier.class === c.name)
        )
          cls.kotlin!.companionValue = true;

        // Declared, its members its class's: extensions of it (`WindowInsets.Companion.systemBars`) name it.
        module.types.push({
          kind: "class",
          name: simpleOf(companion.name),
          native: companionInternal,
          symbol: jvmSymbol(companionInternal),
          kotlin: { kind: "companion" },
        });
      }
    }

    if (c.kind === "enum")
      for (const entry of c.enumEntries)
        props.push({
          name: entry,
          type: { k: "ref", module: packageOf(c.name), name, nullable: false },
          static: true,
          readonly: true,
          symbol: jvmSymbol(internal, `${entry}:L${internal};`),
        });

    if (methods.length) cls.methods = methods;
    if (props.length) cls.properties = props;
    return cls;
  }

  // Receivers of lambdas that nothing else gives: their members, and extensions of
  // them, run inside those lambdas only.
  const classes = new Map<string, SdkClassSchema>();
  const given = obtainable(modules.values());
  for (const m of modules.values())
    for (const t of m.types)
      if (t.kind === "class") {
        const name = `${m.module}.${t.name}`;
        classes.set(name, t);
        if (scopes.has(name) && !given.has(name)) t.kotlin!.scope = true;
      }

  for (const m of modules.values()) {
    const members = [
      ...(m.functions ?? []),
      ...m.types.flatMap((t) => (t.kind === "class" ? (t.methods ?? []) : [])),
    ];

    for (const f of members) {
      const receiver = f.kotlin?.extension ? f.params[0]?.type : undefined;
      const scope = receiver?.k === "ref" ? `${receiver.module}.${receiver.name}` : "";
      if (classes.get(scope)?.kotlin?.scope) f.kotlin!.scope = scope;

      for (const p of f.params) {
        const through = p.kotlin?.receiver && resultThrough(p, classes);
        if (through) p.kotlin!.returnsThrough = through;
      }
    }
  }

  // The dependencies' classes the API names, without members.
  for (const internal of [...named].sort()) {
    const d = declaration(internal);
    const kotlinName = d?.metadataKind === "class" ? d.name : internal.replaceAll("$", ".");
    const module = moduleOf(packageOf(kotlinName), index.get(internal)!.library);
    if (module.types.some((t) => t.name === simpleOf(kotlinName))) continue;

    const kind = d?.metadataKind === "class" ? d.kind : "class";
    module.types.push({
      kind: "class",
      name: simpleOf(kotlinName),
      native: internal,
      symbol: jvmSymbol(internal),
      ...(kind === "interface" ? { interface: true } : {}),
      ...(d?.metadataKind === "class" && d.typeParameters.length
        ? { typeParams: d.typeParameters.map((t) => t.name) }
        : {}),
      kotlin: { kind: kind === "enum-entry" ? "class" : kind },
    });
  }

  for (const m of modules.values()) {
    if (!m.functions!.length) delete m.functions;
    if (!m.constants!.length) delete m.constants;
    if (!m.skipped!.length) delete m.skipped;
  }

  return [...modules.values()].sort((a, b) => (a.module < b.module ? -1 : 1));
}

/**
 * The classes (`module.Name`) the API gives values of: what its functions
 * and properties return, what constructors make, companion objects that
 * are values of their class, enum entries.
 */
function obtainable(modules: Iterable<SdkModuleSchema>): Set<string> {
  const out = new Set<string>();
  const add = (t: SchemaType) => {
    if (t.k === "ref") out.add(`${t.module}.${t.name}`);
  };

  for (const m of modules) {
    for (const f of m.functions ?? []) add(f.returns);
    for (const c of m.constants ?? []) add(c.type);

    for (const t of m.types) {
      if (t.kind !== "class") continue;

      if (t.constructors?.length || t.kotlin?.companionValue) out.add(`${m.module}.${t.name}`);
      for (const f of t.methods ?? []) add(f.returns);
      for (const p of t.properties ?? []) add(p.type);
    }
  }

  return out;
}

/**
 * How a lambda with a receiver makes its result when only the receiver
 * makes values of its type: the receiver's one member that makes one from a
 * function (`DisposableEffectScope.onDispose`), which a Lucent lambda ends
 * by giving the function it returns. Undefined for a lambda giving nothing,
 * or when no single such member makes its result.
 */
function resultThrough(
  p: SdkParam,
  classes: ReadonlyMap<string, SdkClassSchema>,
): string | undefined {
  const fn = p.type;
  const receiver = p.kotlin?.receiver;
  if (fn.k !== "fn" || receiver?.k !== "ref" || fn.ret.k !== "ref") return undefined;

  const ret = fn.ret;
  const makers = (classes.get(`${receiver.module}.${receiver.name}`)?.methods ?? []).filter(
    (m) =>
      !m.static &&
      m.returns.k === "ref" &&
      m.returns.module === ret.module &&
      m.returns.name === ret.name &&
      m.params.length === 1 &&
      m.params[0]!.type.k === "fn",
  );

  return makers.length === 1 ? makers[0]!.name : undefined;
}

/**
 * A function's parameters as overload resolution tells them apart: its
 * receiver's and parameters' types (a vararg's as an array, or, without
 * `varargs`, left out: the call leaving it empty).
 */
function shapeOf(f: KotlinFunction, varargs = true): string {
  const type = (t: KotlinType): string => {
    const c = t.classifier;
    const name = "class" in c ? c.class : "typeParameter" in c ? "T" : c.typeAlias;
    const args = t.arguments.map((a) => (a === "*" ? "*" : type(a.type)));
    return args.length ? `${name}<${args.join(",")}>` : name;
  };
  const params = f.parameters
    .filter((p) => varargs || !p.vararg)
    .map((p) => (p.vararg ? `vararg ${type(p.vararg)}` : type(p.type)));

  return `${f.receiver ? type(f.receiver) : ""}(${params.join(",")})`;
}

/** The shapes of functions by name. */
function overloadShapes(functions: readonly KotlinFunction[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of functions) out.set(f.name, [...(out.get(f.name) ?? []), shapeOf(f)]);
  return out;
}

/** Members every Kotlin class has, which a class's declarations restate. */
const ANY_MEMBERS = new Set(["equals", "hashCode", "toString"]);

/**
 * The applier a `@ComposableInferredTarget` scheme gives the function
 * itself: `[a.B[a.B]]` is `a.B`; an applier variable (`[0[0]]`, the one
 * its content lambdas have) is `*`, its caller's; none for `_`.
 */
function ownApplier(scheme: string | undefined): string | undefined {
  const own = scheme && /^\[([^[\]:]+)/.exec(scheme)?.[1];
  if (!own || own === "_") return undefined;

  return /^\d+$/.test(own) ? "*" : own;
}

/** The archives of a jar or AAR (its classes.jar and libs). */
function archives(file: string): ZipArchive[] {
  const zip = new ZipArchive(file);
  if (!file.endsWith(".aar")) return [zip];

  return zip
    .names()
    .filter((n) => n === "classes.jar" || /^libs\/[^/]+\.jar$/.test(n))
    .map((n) => new ZipArchive(zip.read(n)!));
}

/** A Kotlin class name's JVM class: `a/B.C` is `a/B$C`. */
function internalOf(kotlinName: string, index: ReadonlyMap<string, unknown>): string | undefined {
  const internal = kotlinName.replaceAll(".", "$");
  return index.has(internal) ? internal : undefined;
}

/** Whether a nested class's outer classes are API. */
function outersVisible(
  kotlinName: string,
  declaration: (internal: string) => KotlinDeclaration | undefined,
): boolean {
  const dot = kotlinName.lastIndexOf(".");
  if (dot < 0) return true;

  const outer = kotlinName.slice(0, dot);
  const d = declaration(outer.replaceAll(".", "$"));
  return !!d && d.metadataKind === "class" && outersVisible(outer, declaration);
}

const packageOf = (name: string) =>
  name.slice(0, Math.max(0, name.lastIndexOf("/"))).replaceAll("/", ".");
/** A class's name in its module: nested classes joined with `_`, as android.ts names them. */
const simpleOf = (kotlinName: string) =>
  kotlinName.slice(kotlinName.lastIndexOf("/") + 1).replaceAll(".", "_");
const dotted = (kotlinName: string) => kotlinName.replaceAll("/", ".");
const refOf = (kotlinName: string): SchemaType => ({
  k: "ref",
  module: packageOf(kotlinName),
  name: simpleOf(kotlinName),
  nullable: false,
});

const PRIMS: Record<string, PrimName> = {
  "kotlin/Unit": "void",
  "kotlin/Boolean": "boolean",
  "kotlin/Byte": "byte",
  "kotlin/Short": "short",
  "kotlin/Int": "int",
  "kotlin/Long": "long",
  "kotlin/Float": "float",
  "kotlin/Double": "double",
  "kotlin/Char": "char",
};

const PRIM_ARRAYS: Record<string, PrimName> = {
  "kotlin/BooleanArray": "boolean",
  "kotlin/ByteArray": "byte",
  "kotlin/ShortArray": "short",
  "kotlin/IntArray": "int",
  "kotlin/LongArray": "long",
  "kotlin/FloatArray": "float",
  "kotlin/DoubleArray": "double",
};

/** A function type as a parameter's: its schema type, and what the parameter facts say of it. */
interface Lambda {
  type: SchemaType & { k: "fn" };
  composable: boolean;
  suspend: boolean;
  receiver?: SchemaType;
}

/** Kotlin types as schema types, with type parameters' names in scope. */
class TypeReader {
  private readonly tparams: ReadonlyMap<number, string>;
  private readonly classRef: (kotlinName: string) => SchemaType;

  constructor(tparams: ReadonlyMap<number, string>, classRef: (kotlinName: string) => SchemaType) {
    this.tparams = tparams;
    this.classRef = classRef;
  }

  /** A function type (`@Composable RowScope.() -> Unit`), or undefined for another type. */
  lambda(t: KotlinType): Lambda | undefined {
    const name = "class" in t.classifier ? t.classifier.class : "";
    if (!/^kotlin\/Function\d+$/.test(name)) return undefined;

    const args = t.arguments.map((a) => {
      if (a === "*") throw new Unsupported("a function type with a star projection");
      return a.type;
    });
    const ret = args.pop()!;
    const extension = !!t.annotations?.includes(EXTENSION_FUNCTION_TYPE);
    const receiver = extension ? args.shift() : undefined;

    // A suspend function type: `suspend (A) -> R` is Function2<A, Continuation<R>, Any?>.
    let result = ret;
    if (t.suspend) {
      const continuation = args.pop();
      const completes = continuation?.arguments[0];
      if (!completes || completes === "*")
        throw new Unsupported("a suspend function type without its result");
      result = completes.type;
    }

    return {
      type: {
        k: "fn",
        params: args.map((a) => this.type(a)),
        ret: this.type(result),
        escaping: true,
        main: false,
        nullable: t.nullable,
      },
      composable: !!t.annotations?.includes(COMPOSE.composableType),
      suspend: !!t.suspend,
      ...(receiver ? { receiver: this.type(receiver) } : {}),
    };
  }

  type(t: KotlinType): SchemaType {
    const nullable = t.nullable;
    const c = t.classifier;

    if ("typeParameter" in c) {
      const name = this.tparams.get(c.typeParameter);
      if (!name) throw new Unsupported("a type parameter out of scope");
      return { k: "tparam", name, nullable };
    }

    if ("typeAlias" in c) throw new Unsupported(`refers to the type alias ${dotted(c.typeAlias)}`);

    const name = c.class;
    const prim = PRIMS[name];
    if (prim) return { k: "prim", name: prim, nullable };

    if (name === "kotlin/String" || name === "kotlin/CharSequence")
      return {
        k: "string",
        nullable,
        ...(name === "kotlin/CharSequence" ? { charSequence: true } : {}),
      };

    if (name === "kotlin/Nothing") throw new Unsupported("Kotlin's Nothing has no Lucent type");

    const lambda = this.lambda(t);
    if (lambda) {
      if (lambda.receiver)
        throw new Unsupported("a function type with a receiver, other than a parameter's");
      if (lambda.composable)
        throw new Unsupported("a composable function type, other than a parameter's");
      return lambda.type;
    }

    const args = t.arguments.map((a) => {
      if (a === "*") throw new Unsupported(`a star projection (${dotted(name)}<*>)`);
      return this.type(a.type);
    });

    if (PRIM_ARRAYS[name])
      return { k: "array", of: { k: "prim", name: PRIM_ARRAYS[name]!, nullable: false }, nullable };
    if (name === "kotlin/Array") return { k: "array", of: args[0]!, nullable };
    // A read-only list, or any collection (content gives a list).
    if (name === "kotlin/collections/List" || name === "kotlin/collections/Collection")
      return { k: "array", of: args[0]!, nullable, list: true };
    if (name === "kotlin/Any") return { k: "ref", module: "kotlin", name: "Any", nullable };
    if (name.startsWith("kotlin/"))
      throw new Unsupported(`Kotlin's ${dotted(name)} has no Lucent type yet`);

    const ref = this.classRef(name);
    return { ...ref, nullable, ...(args.length ? { args } : {}) } as SchemaType;
  }
}

/** Whether two schema types are one (a value and its change callback's argument). */
function sameType(a: SchemaType, b: SchemaType): boolean {
  return JSON.stringify({ ...a, nullable: false }) === JSON.stringify({ ...b, nullable: false });
}
