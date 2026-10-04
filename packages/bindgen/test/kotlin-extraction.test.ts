import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { extractAndroid } from "../src/android.ts";
import {
  androidJars,
  extractionCount,
  forgetLoadedSdks,
  sdkAvailable,
  sdkModule,
} from "../src/provider.ts";
import {
  parseSchemaType,
  type SchemaType,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
} from "../src/schema.ts";
import { classpathFile, javaJar } from "./java-fixtures.ts";
import {
  compileKotlin,
  kotlinFixtures,
  kotlinSources,
  kotlinToolchain,
  versionFixtures,
} from "./kotlin-toolchain.ts";
import { runJar } from "./jvm-tools.ts";

/*
 * Android extraction of Kotlin libraries: the fixture library of
 * fixtures/kotlin, and fixtures/kotlin-interop, where Kotlin and Java
 * classes extend each other. Declarations describe the Kotlin source (its
 * names, nullability, suspend functions, defaults, properties, extensions
 * and top-level declarations), and keep the exact JVM method each one is.
 */

const tc = kotlinToolchain();

const android = sdkAvailable("android");

/** A schema type from its written form (`string?`, `java.util.List<string>`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const interopFixtures = path.join(kotlinFixtures, "../kotlin-interop/dev/orbit/interop");

const collectionFixtures = path.join(kotlinFixtures, "../kotlin-collections");

/** Every type a schema's members name, however deep. */
function typesIn(schema: SdkModuleSchema): SchemaType[] {
  const out: SchemaType[] = [];
  const walk = (t: SchemaType): void => {
    out.push(t);
    if (t.k === "array" || t.k === "set" || t.k === "record" || t.k === "out") walk(t.of);
    if (t.k === "ref") t.args?.forEach(walk);
    if (t.k === "fn") [...t.params, t.ret].forEach(walk);
  };

  for (const c of schema.types) {
    if (c.kind !== "class") continue;

    for (const m of c.constructors ?? []) m.params.forEach((p) => walk(p.type));
    for (const m of c.methods ?? []) [...m.params.map((p) => p.type), m.returns].forEach(walk);
    for (const p of c.properties ?? []) walk(p.type);
  }

  return out;
}

describe.skipIf(!tc || !android)("Android extraction of Kotlin libraries", () => {
  let jars: string[];
  let modules: Map<string, SdkModuleSchema>;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-extraction-"));
    const stdlib = path.join(tc!.lib, "kotlin-stdlib.jar");
    const coroutines = path.join(tc!.lib, "kotlinx-coroutines-core-jvm.jar");
    const java = (name: string) => path.join(interopFixtures, name);

    const [fixture, interop, collections] = await Promise.all([
      compileKotlin(tc!, kotlinSources(kotlinFixtures), path.join(dir, "fixture.jar")),
      // Kotlin compiled against the Java sources it extends, then the Java against it.
      compileKotlin(
        tc!,
        [java("KotlinBase.kt"), java("JavaBase.java"), java("JavaOnKotlin.java")],
        path.join(dir, "interop.jar"),
      ),
      compileKotlin(tc!, kotlinSources(collectionFixtures), path.join(dir, "collections.jar"), {
        classpath: coroutines,
      }),
    ]);
    const interopJava = javaJar(
      path.join(dir, "interop-java.jar"),
      Object.fromEntries(
        ["JavaBase.java", "JavaOnKotlin.java"].map((f) => [
          `dev/orbit/interop/${f}`,
          fs.readFileSync(java(f), "utf8"),
        ]),
      ),
      [interop, stdlib],
    );
    const versions = javaJar(
      path.join(dir, "versions.jar"),
      {
        "dev/orbit/future/FutureKt.java": fs.readFileSync(
          path.join(versionFixtures, "future/FutureKt.java"),
          "utf8",
        ),
        "dev/orbit/prerelease/PreReleaseKt.java": fs.readFileSync(
          path.join(versionFixtures, "prerelease/PreReleaseKt.java"),
          "utf8",
        ),
      },
      [stdlib],
    );

    // Metadata naming a JVM method the class file does not have: measure(I)I,
    // whose descriptor is rewritten in place to (J)I.
    const driftDir = path.join(dir, "drift");
    const driftSource = path.join(dir, "Drift.kt");
    fs.writeFileSync(
      driftSource,
      'package dev.orbit.drift\n\nclass Drift {\n  fun measure(x: Int): Int = x\n\n  fun kept(): String = "kept"\n}\n',
    );
    await compileKotlin(tc!, [driftSource], driftDir);
    const driftClass = path.join(driftDir, "dev/orbit/drift/Drift.class");
    fs.writeFileSync(
      driftClass,
      Buffer.from(fs.readFileSync(driftClass).toString("latin1").replace("(I)I", "(J)I"), "latin1"),
    );
    const drift = path.join(dir, "drift.jar");
    runJar(["cf", drift, "-C", driftDir, "dev"]);

    jars = [
      ...androidJars()!,
      stdlib,
      coroutines,
      fixture,
      interop,
      interopJava,
      versions,
      drift,
      collections,
    ];
    modules = new Map(
      extractAndroid({
        jars,
        packages: [
          "dev.orbit.search",
          "dev.orbit.interop",
          "dev.orbit.future",
          "dev.orbit.prerelease",
          "dev.orbit.drift",
          "dev.orbit.shelf",
        ],
      }).map((m) => [m.module, m]),
    );
  }, 300_000);

  const module = (name: string) => modules.get(name)!;
  const cls = (pkg: string, name: string): SdkClassSchema => {
    const found = module(pkg).types.find((t) => t.name === name);
    if (found?.kind !== "class") throw new Error(`no class ${pkg}.${name}`);
    return found;
  };
  const search = (name: string) => cls("dev.orbit.search", name);
  const interop = (name: string) => cls("dev.orbit.interop", name);
  const methods = (c: SdkClassSchema, name: string) =>
    (c.methods ?? []).filter((m) => m.name === name);
  const method = (c: SdkClassSchema, name: string): SdkMethodSchema => {
    const [found, ...more] = methods(c, name);
    if (!found || more.length) throw new Error(`not one method ${c.name}.${name}`);
    return found;
  };
  const property = (c: SdkClassSchema, name: string) => c.properties?.find((p) => p.name === name);

  it("reads a suspend function as Kotlin declares it, keeping the JVM method it is", () => {
    const client = search("SearchClient");
    const descriptor = "(Ljava/lang/String;ILkotlin/coroutines/Continuation;)Ljava/lang/Object;";

    expect(method(client, "search")).toMatchObject({
      params: [
        { name: "prefix", type: T("string") },
        { name: "limit", type: T("int"), kotlin: { default: true } },
      ],
      returns: T("List<dev.orbit.search.SearchHit>"),
      descriptor,
      symbol: `jvm:dev/orbit/search/SearchClient#search${descriptor}`,
      kotlin: { suspend: true },
    });
    expect(method(client, "search").params[0]).not.toHaveProperty("kotlin");
    expect(method(interop("KotlinBase"), "load")).toMatchObject({
      params: [{ name: "id", type: T("int") }],
      returns: T("string?"),
      kotlin: { suspend: true },
    });
  });

  it("never declares the JVM's plumbing: continuations, default masks, markers, internals", () => {
    const refs = [...modules.values()]
      .flatMap(typesIn)
      .filter((t) => t.k === "ref")
      .map((t) => `${t.module}.${t.name}`);
    const members = [...modules.values()].flatMap((m) =>
      m.types.flatMap((t) =>
        t.kind === "class" ? (t.methods ?? []).map((x) => `${t.name}.${x.name}`) : [],
      ),
    );
    const classes = module("dev.orbit.search").types.map((t) => t.name);

    expect(refs).not.toContain("kotlin.coroutines.Continuation");
    expect(refs).not.toContain("kotlin.jvm.internal.DefaultConstructorMarker");
    expect(members.filter((m) => m.includes("$") || m.includes("-"))).toEqual([]);
    expect(members).not.toContain("ExtensionsKt.hiddenHelper");
    expect(classes).not.toContain("Listener_DefaultImpls");
    expect(classes).not.toContain("InternalThing");
    expect(classes).not.toContain("Queries__QueriesTextKt");
    expect(search("SearchClient").constructors?.map((c) => c.descriptor)).not.toContain(
      "(Ljava/lang/String;Ljava/lang/String;ILkotlin/jvm/internal/DefaultConstructorMarker;)V",
    );
  });

  it("declares extensions as functions taking their receiver first", () => {
    const extensions = search("ExtensionsKt");

    expect(method(extensions, "toQuery")).toMatchObject({
      static: true,
      params: [
        { name: "receiver", type: T("string") },
        { name: "limit", type: T("int"), kotlin: { default: true } },
      ],
      returns: T("string"),
      descriptor: "(Ljava/lang/String;I)Ljava/lang/String;",
      kotlin: { extension: true },
    });
    expect(method(extensions, "first")).toMatchObject({
      params: [
        { name: "receiver", type: T("dev.orbit.search.SearchClient") },
        { name: "prefix", type: T("string") },
      ],
      returns: T("dev.orbit.search.SearchHit?"),
      kotlin: { suspend: true, extension: true },
    });
    expect(method(extensions, "getShortTitle")).toMatchObject({
      params: [{ name: "receiver", type: T("dev.orbit.search.SearchHit") }],
      returns: T("string"),
      kotlin: { extension: true },
    });
    expect(method(extensions, "setMarker")).toMatchObject({
      params: [
        { name: "receiver", type: T("java.lang.StringBuilder") },
        { name: "value", type: T("char") },
      ],
      kotlin: { extension: true },
    });
    // An extension property is its accessors, not a property of the facade.
    expect(extensions.properties?.map((p) => p.name)).not.toContain("shortTitle");
  });

  it("declares top-level functions and properties as statics of their facade classes", () => {
    const extensions = search("ExtensionsKt");
    const queries = search("Queries");

    expect(extensions.kotlin).toEqual({ kind: "file-facade" });
    expect(property(extensions, "MAX_LIMIT")).toMatchObject({ static: true, value: 100 });
    expect(property(extensions, "VERSION")).toMatchObject({
      static: true,
      readonly: true,
      getter: "getVERSION",
      type: T("string"),
    });
    expect(property(extensions, "verbose")).toMatchObject({
      static: true,
      getter: "getVerbose",
      setter: "setVerbose",
      type: T("boolean"),
    });
    expect(property(extensions, "verbose")?.readonly).toBeFalsy();

    // A multi-file facade: its members are its parts', as Kotlin declares them.
    expect(queries.kotlin).toEqual({ kind: "multi-file-facade" });
    expect(method(queries, "clampLimit")).toMatchObject({
      static: true,
      params: [{ name: "limit", type: T("java.lang.Integer?") }],
      returns: T("int"),
    });
    expect(method(queries, "normalize").params).toEqual([{ name: "query", type: T("string") }]);
  });

  it("reads properties from Kotlin, with their accessors, rather than from getter names", () => {
    const client = search("SearchClient");
    const base = interop("KotlinBase");

    expect(property(client, "endpoint")).toMatchObject({
      getter: "getEndpoint",
      readonly: true,
      type: T("string"),
    });
    expect(property(client, "lastQuery")).toMatchObject({ readonly: true, type: T("string?") });
    expect(property(client, "pageSize")).toMatchObject({
      getter: "getPageSize",
      setter: "setPageSize",
      type: T("int"),
    });
    expect(property(client, "pageSize")?.readonly).toBeFalsy();
    // A lateinit property's field is public too: one property, read through its getter.
    expect(client.properties?.filter((p) => p.name === "session")).toMatchObject([
      { getter: "getSession", setter: "setSession" },
    ]);
    // Kotlin's name, which a getter's (`isEnabled` → `enabled`) would not give.
    expect(property(base, "isEnabled")).toMatchObject({
      getter: "isEnabled",
      setter: "setEnabled",
      type: T("boolean"),
    });
    expect(property(base, "enabled")).toBeUndefined();
  });

  it("keeps the overloads and bridges Kotlin generates for Java callers", () => {
    const client = search("SearchClient");

    expect(methods(client, "configure").map((m) => m.descriptor)).toEqual([
      "()V",
      "(I)V",
      "(ILjava/lang/String;)V",
    ]);
    expect(methods(client, "configure")[2]!.params).toEqual([
      { name: "retries", type: T("int"), kotlin: { default: true } },
      { name: "label", type: T("string"), kotlin: { default: true } },
    ]);
    expect(client.constructors?.map((c) => c.descriptor)).toContain("()V");
    expect(method(client, "create")).toMatchObject({ static: true });
    expect(method(client, "reset")).toMatchObject({ java: "resetAll", params: [] });
    expect(methods(search("Mode"), "values")).toHaveLength(1);
  });

  it("types values with Kotlin's nullability where Java's is unknown or a default", () => {
    const base = interop("KotlinBase");

    // A type argument: nullable in Kotlin, non-null by Java's default.
    expect(property(base, "tags")?.type).toEqual(T("List<string?>"));
    // A type variable: non-null in Kotlin, nullable by Java's default.
    expect(method(base, "identity")).toMatchObject({
      params: [{ name: "value", type: T("T", ["T"]) }],
      returns: T("T", ["T"]),
    });
    // A platform type: unknown to Kotlin too, so Java's rule holds.
    expect(method(search("ExtensionsKt"), "systemName").returns).toEqual(T("string?"));
    expect(method(search("SearchClient"), "searchNow").returns).toEqual(
      T("List<dev.orbit.search.SearchHit>?"),
    );
  });

  it("copies Kotlin's read-only lists, and keeps the lists whose identity may matter", () => {
    const shelf = cls("dev.orbit.shelf", "Shelf");
    const box = cls("dev.orbit.shelf", "Box");
    const copyInto = method(search("SearchClient"), "copyInto");

    // A read-only list, however it is typed: a copy of its elements.
    expect(property(shelf, "titles")?.type).toEqual(T("List<string>"));
    expect(method(shelf, "maybe").returns).toEqual(T("List<string?>"));
    expect(method(shelf, "optional").returns).toEqual(T("List<double>?"));
    expect(method(shelf, "grid").returns).toEqual(T("List<List<int>>"));
    expect(copyInto.params[1]!.type).toEqual(T("List<dev.orbit.search.SearchHit>"));
    expect(method(box, "repeat").returns).toEqual(T("List<T>", ["T"]));
    expect(method(box, "count").params[0]!.type).toEqual(T("List<T>", ["T"]));

    // Numbers and booleans Kotlin boxes are numbers, in lists and other type arguments.
    expect(method(shelf, "counts").returns).toEqual(T("List<int>"));
    expect(method(shelf, "total").params[0]!.type).toEqual(T("List<long>"));
    expect(method(shelf, "counted").returns).toEqual(T("kotlinx.coroutines.flow.Flow<int>"));

    // Mutable, star-projected and Java lists stay Java objects; arrays stay arrays.
    expect(property(shelf, "live")?.type).toEqual(T("java.util.List<string>"));
    expect(method(shelf, "anything").params[0]!.type).toEqual(T("java.util.List"));
    expect(copyInto.params[0]!.type).toEqual(T("java.util.List<dev.orbit.search.SearchHit>"));
    expect(method(shelf, "sizes").returns).toEqual(T("int[]"));
    expect(method(shelf, "names").returns).toEqual(T("string[]"));
    expect(module("dev.orbit.shelf").skipped).toEqual([]);
  });

  it("keeps value classes as Kotlin types, and marks what the JVM passes unboxed", () => {
    const hitId = search("HitId");

    expect(hitId.kotlin).toEqual({ kind: "class", value: { property: "raw", type: T("long") } });
    expect(hitId.constructors).toEqual([
      expect.objectContaining({
        params: [{ name: "raw", type: T("long") }],
        descriptor: "(J)J",
        symbol: "jvm:dev/orbit/search/HitId#constructor-impl(J)J",
        kotlin: { unboxed: true },
      }),
    ]);
    expect(method(search("ExtensionsKt"), "id")).toMatchObject({
      params: [{ name: "receiver", type: T("dev.orbit.search.SearchHit") }],
      returns: T("dev.orbit.search.HitId"),
      descriptor: "(Ldev/orbit/search/SearchHit;)J",
      kotlin: { extension: true, unboxed: true },
    });
  });

  it("describes sealed, data, object, companion and enum classes", () => {
    expect(search("SearchResult").kotlin).toEqual({
      kind: "interface",
      sealed: [
        "dev.orbit.search.SearchResult_Empty",
        "dev.orbit.search.SearchResult_Failed",
        "dev.orbit.search.SearchResult_Found",
      ],
    });
    expect(search("Filter").kotlin).toEqual({
      kind: "class",
      sealed: ["dev.orbit.search.Filter_All", "dev.orbit.search.Filter_Prefix"],
    });
    expect(search("SearchResult_Empty").kotlin).toEqual({ kind: "object", data: true });
    expect(search("SearchHit").kotlin).toEqual({ kind: "class", data: true });
    expect(search("SearchClient_Companion").kotlin).toEqual({ kind: "companion" });
    expect(search("Mode").kotlin).toEqual({ kind: "enum" });
  });

  it("types the static fields Kotlin never leaves null as non-null", () => {
    expect(property(search("Mode"), "FAST")?.type).toEqual(T("dev.orbit.search.Mode"));
    expect(property(search("Filter_All"), "INSTANCE")?.type).toEqual(
      T("dev.orbit.search.Filter_All"),
    );
    expect(property(search("SearchClient"), "Companion")?.type).toEqual(
      T("dev.orbit.search.SearchClient_Companion"),
    );
  });

  it("leaves out the public field of a companion that is not API", () => {
    expect(property(interop("KotlinBase"), "Companion")).toBeUndefined();
    expect(module("dev.orbit.interop").types.map((t) => t.name)).not.toContain(
      "KotlinBase_Companion",
    );
    expect(module("dev.orbit.interop").skipped).toEqual([]);
  });

  it("records type parameters' bounds, and those other than Any as a shim writes them", () => {
    const box = cls("dev.orbit.shelf", "Box");
    const comparable = (of: string) => [{ name: "kotlin.Comparable", args: [{ name: of }] }];

    expect(method(search("SearchClient"), "best").kotlin).toEqual({
      bounds: { T: "other" },
      upperBounds: { T: comparable("T") },
    });
    expect(box.kotlin).toEqual({ kind: "class" });
    expect(cls("dev.orbit.shelf", "Keyed").kotlin).toEqual({
      kind: "class",
      bounds: { K: "non-null", V: "other" },
      upperBounds: { V: comparable("V") },
    });
  });

  it("types a Kotlin function type as the function it is, not the FunctionN class", () => {
    const dial = cls("dev.orbit.shelf", "Dial");
    const fn = (s: string, nullable = false): SchemaType => ({ ...T(s), nullable });

    expect(property(dial, "onTurn")?.type).toEqual(fn("@escaping (double) => void", true));
    expect(property(dial, "format")?.type).toEqual(fn("@escaping (int) => string"));
    expect(method(dial, "scaler").returns).toEqual(fn("@escaping (double) => double"));
    expect(method(dial, "filter").params).toEqual([
      { name: "test", type: fn("@escaping (string, int) => boolean") },
    ]);
  });

  it("names a value class property's accessors as Kotlin does, keeping their mangled JVM names", () => {
    const dial = cls("dev.orbit.shelf", "Dial");
    const accessors = (dial.methods ?? []).filter((m) => m.name.endsWith("Turns"));

    expect(accessors.map((m) => [m.name, m.java])).toEqual([
      ["getTurns", expect.stringMatching(/^getTurns-/)],
      ["setTurns", expect.stringMatching(/^setTurns-/)],
    ]);
    expect(property(dial, "turns")).toMatchObject({
      getter: expect.stringMatching(/^getTurns-/),
      setter: expect.stringMatching(/^setTurns-/),
      kotlin: { unboxed: true },
    });
  });

  it("marks fun interfaces, whose functions a lambda implements", () => {
    expect(cls("dev.orbit.shelf", "Visitor").kotlin).toEqual({ kind: "interface", fun: true });
    expect(cls("dev.orbit.shelf", "Visitor").functional).toBe("visit");
  });

  it("types a suspend function parameter as the function Kotlin declares, not its lowered form", () => {
    expect(method(search("SearchClient"), "onResult").params).toEqual([
      {
        name: "block",
        type: T("@escaping (dev.orbit.search.SearchHit) => void"),
        kotlin: { suspendFunction: true },
      },
    ]);
  });

  it("reads a Kotlin class extending a Java class, and a Java class extending a Kotlin one", () => {
    const onJava = interop("KotlinOnJava");
    const javaBase = interop("JavaBase");
    const onKotlin = interop("JavaOnKotlin");

    expect(onJava).toMatchObject({
      extends: "dev.orbit.interop.JavaBase",
      kotlin: { kind: "class" },
    });
    expect(method(onJava, "describe")).toMatchObject({
      params: [{ name: "value", type: T("string") }],
      returns: T("string"),
    });
    // Java without annotations: nullable, by Java's rule.
    expect(javaBase).not.toHaveProperty("kotlin");
    expect(method(javaBase, "describe")).toMatchObject({
      params: [{ name: "arg0", type: T("string?") }],
      returns: T("string?"),
    });

    // Java extending Kotlin: Java's view of its own members; an override
    // without annotations keeps the result contract of the Kotlin method.
    expect(onKotlin).toMatchObject({ extends: "dev.orbit.interop.KotlinBase" });
    expect(onKotlin).not.toHaveProperty("kotlin");
    expect(method(onKotlin, "label")).toMatchObject({
      params: [{ name: "arg0", type: T("string?") }],
      returns: T("string"),
    });
    expect(method(onKotlin, "label")).not.toHaveProperty("kotlin");
    expect(method(interop("KotlinBase"), "label").params).toEqual([
      { name: "prefix", type: T("string"), kotlin: { default: true } },
    ]);
  });

  it("declares a class whose metadata it cannot read as Java sees it, and says why", () => {
    expect(cls("dev.orbit.future", "FutureKt")).not.toHaveProperty("kotlin");
    expect(module("dev.orbit.future").skipped).toEqual([
      "dev.orbit.future.FutureKt: its Kotlin metadata was not read (unsupported Kotlin metadata version 99.0.0; this reader reads 1.1 to 2.5)",
    ]);
    expect(module("dev.orbit.prerelease").skipped).toEqual([
      expect.stringMatching(
        /^dev\.orbit\.prerelease\.PreReleaseKt: its Kotlin metadata was not read \(unsupported Kotlin metadata version 1\.0\.0;/,
      ),
    ]);
  });

  it("declares no member whose metadata names a JVM method the class file does not have", () => {
    const drift = cls("dev.orbit.drift", "Drift");

    expect(drift.methods?.map((m) => m.name)).toEqual(["kept"]);
    expect(module("dev.orbit.drift").skipped).toEqual([
      "dev.orbit.drift.Drift.measure(I)I: its Kotlin metadata names a JVM method the class file does not have",
    ]);
  });

  it("extracts Kotlin facts through the SDK cache, once", () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-cache-"));
    const classpath = classpathFile(
      path.join(cacheDir, "android-classpath.json"),
      jars.slice(androidJars()!.length),
    );
    const opts = { cacheDir, android: { classpath } };

    const before = extractionCount();
    const first = sdkModule("android", "dev.orbit.search", opts);
    forgetLoadedSdks();
    const again = sdkModule("android", "dev.orbit.search", opts);

    expect(extractionCount() - before).toBe(1);
    expect(again).toEqual(first);
    expect(
      "schema" in again && again.schema.types.find((t) => t.name === "SearchClient"),
    ).toMatchObject({
      kotlin: { kind: "class" },
    });
  });
});
