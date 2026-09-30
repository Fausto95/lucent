import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  jvmMemberRoles,
  type KotlinClass,
  type KotlinDeclaration,
  type KotlinFileFacade,
  type KotlinMetadataBatch,
  type KotlinType,
} from "../src/kotlin-metadata.ts";
import { readKotlinMetadata } from "../src/kotlin-metadata-reader.ts";
import {
  buildHelper,
  compileJava,
  compileKotlin,
  kotlinFixtures,
  kotlinSources,
  kotlinToolchain,
  readWithHelper,
  versionFixtures,
} from "./kotlin-toolchain.ts";

/*
 * Two readers of Kotlin metadata, compared over one fixture library
 * (fixtures/kotlin): the official kotlin-metadata-jvm library in a JVM process
 * (packages/bindgen/kotlin-helper), and the TypeScript decoder. Both must
 * produce the normalized contract of src/kotlin-metadata.ts.
 *
 * The golden file is the JVM reader's output without metadata versions,
 * with the kotlinc major.minor that produced it; LUCENT_UPDATE_KOTLIN_GOLDEN=1
 * rewrites it (then pnpm fix formats it).
 */

const tc = kotlinToolchain();

const golden = path.join(kotlinFixtures, "metadata.golden.json");

/** The golden file: the normalized output of one kotlinc major.minor. */
const recorded = JSON.parse(fs.readFileSync(golden, "utf8")) as { kotlinc: string };

/** A Kotlin class type, non-null, as the contract writes it. */
const cls = (name: string, ...args: KotlinType[]): KotlinType => ({
  classifier: { class: name },
  nullable: false,
  arguments: args.map((type) => ({ variance: "invariant" as const, type })),
});

const nullable = (t: KotlinType): KotlinType => ({ ...t, nullable: true });

const search = (name: string) => `dev/orbit/search/${name}`;

/** Declarations without their metadata versions, which follow the compiler. */
const withoutVersions = (batch: KotlinMetadataBatch) =>
  batch.inputs.map((input) =>
    input.declarations.map((d) =>
      Object.fromEntries(Object.entries(d).filter(([key]) => key !== "metadataVersion")),
    ),
  );

describe.skipIf(!tc)("Kotlin metadata readers", () => {
  let jvm: KotlinMetadataBatch;
  let ts: KotlinMetadataBatch;
  let helperJar: string;
  let sevenBitJar: string;
  let futureDir: string;
  let preReleaseDir: string;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-kotlin-"));
    const sources = kotlinSources(kotlinFixtures);

    let fixtureJar: string;
    [fixtureJar, sevenBitJar, helperJar, futureDir, preReleaseDir] = await Promise.all([
      compileKotlin(tc!, sources, path.join(dir, "fixture.jar")),
      // The encoding older compilers wrote d1 in; still readable.
      compileKotlin(
        tc!,
        sources.filter((s) => s.endsWith("SearchClient.kt")),
        path.join(dir, "seven-bit.jar"),
        { env: { JAVA_OPTS: "-Dkotlin.jvm.serialization.use8to7=true" } },
      ),
      buildHelper(tc!, path.join(dir, "helper.jar")),
      compileJava(
        tc!,
        [path.join(versionFixtures, "future/FutureKt.java")],
        path.join(dir, "future"),
      ),
      compileJava(
        tc!,
        [path.join(versionFixtures, "prerelease/PreReleaseKt.java")],
        path.join(dir, "prerelease"),
      ),
    ]);

    jvm = readWithHelper(tc!, helperJar, [fixtureJar]);
    ts = JSON.parse(JSON.stringify(readKotlinMetadata([fixtureJar]))) as KotlinMetadataBatch;
  }, 300_000);

  it("reads the same declarations with the official library and the TypeScript decoder", () => {
    expect(ts).toStrictEqual(jvm);
  });

  // Another compiler may generate other members; the readers' agreement is tested above.
  it.skipIf(tc && !tc.version.startsWith(`${recorded.kotlinc}.`))(
    "matches the output recorded with the same kotlinc",
    () => {
      if (process.env.LUCENT_UPDATE_KOTLIN_GOLDEN === "1") {
        const [major, minor] = tc!.version.split(".");
        const record = { kotlinc: `${major}.${minor}`, inputs: withoutVersions(jvm) };
        fs.writeFileSync(golden, `${JSON.stringify(record, null, 2)}\n`);
      }

      const { inputs } = JSON.parse(fs.readFileSync(golden, "utf8")) as { inputs: unknown };
      expect(withoutVersions(jvm)).toStrictEqual(inputs);
      expect(withoutVersions(ts)).toStrictEqual(inputs);
    },
  );

  it("decodes metadata written with the older 8-to-7 bit encoding", () => {
    const sevenBit = readKotlinMetadata([sevenBitJar]).inputs[0]!.declarations;
    const names = new Set(sevenBit.map((d) => d.jvmName));

    expect(sevenBit.map((d) => d.jvmName)).toContain(search("SearchClient"));
    expect(JSON.parse(JSON.stringify(sevenBit))).toStrictEqual(
      ts.inputs[0]!.declarations.filter((d) => names.has(d.jvmName)),
    );
  });

  it("rejects metadata versions it cannot read, naming the class", () => {
    expect(() => readWithHelper(tc!, helperJar, [futureDir])).toThrow(
      /dev\/orbit\/future\/FutureKt: .*version 99\.0\.0/,
    );
    expect(() => readKotlinMetadata([futureDir])).toThrow(
      "dev/orbit/future/FutureKt: unsupported Kotlin metadata version 99.0.0; this reader reads 1.1 to 2.5",
    );

    expect(() => readWithHelper(tc!, helperJar, [preReleaseDir])).toThrow(
      /dev\/orbit\/prerelease\/PreReleaseKt: .*version 1\.0\.0/,
    );
    expect(() => readKotlinMetadata([preReleaseDir])).toThrow(
      "dev/orbit/prerelease/PreReleaseKt: unsupported Kotlin metadata version 1.0.0",
    );
  });

  describe.each([
    ["the official library", () => jvm],
    ["the TypeScript decoder", () => ts],
  ])("with %s", (_, batch) => {
    const declaration = (name: string): KotlinDeclaration => {
      const found = batch().inputs[0]!.declarations.find((d) => d.jvmName === search(name));
      if (!found) throw new Error(`no declaration ${name}`);
      return found;
    };
    const klass = (name: string) => declaration(name) as KotlinClass;
    const facade = (name: string) => declaration(name) as KotlinFileFacade;
    const fn = (owner: KotlinClass | KotlinFileFacade, name: string) =>
      owner.functions.find((f) => f.name === name)!;
    const property = (owner: KotlinClass | KotlinFileFacade, name: string) =>
      owner.properties.find((p) => p.name === name)!;

    it("records the metadata version and kind of each class file", () => {
      expect(declaration("SearchClient").metadataVersion).toMatch(/^2\.\d+\.\d+$/);
      expect(declaration("SearchClient").metadataKind).toBe("class");
      expect(declaration("ExtensionsKt").metadataKind).toBe("file-facade");
      expect(declaration("Queries").metadataKind).toBe("multi-file-facade");
      expect(declaration("Queries__QueriesTextKt").metadataKind).toBe("multi-file-part");
      expect(declaration("ExtensionsKt$first$1").metadataKind).toBe("synthetic");
    });

    it("keeps a suspend function's source parameters and its JVM descriptor", () => {
      const searchFn = fn(klass("SearchClient"), "search");

      expect(searchFn).toMatchObject({
        suspend: true,
        jvm: {
          name: "search",
          descriptor: "(Ljava/lang/String;ILkotlin/coroutines/Continuation;)Ljava/lang/Object;",
        },
        returnType: cls("kotlin/collections/List", cls(search("SearchHit"))),
      });
      expect(searchFn.parameters.map((p) => p.name)).toEqual(["prefix", "limit"]);
    });

    it("marks parameters that declare defaults and lists no $default bridge", () => {
      const client = klass("SearchClient");
      const [prefix, limit] = fn(client, "search").parameters;

      expect(prefix).not.toHaveProperty("declaresDefault");
      expect(limit).toMatchObject({
        name: "limit",
        type: cls("kotlin/Int"),
        declaresDefault: true,
      });
      expect(client.constructors[0]!.parameters.every((p) => p.declaresDefault)).toBe(true);
      expect(fn(client, "configure").parameters.map((p) => p.declaresDefault)).toEqual([
        true,
        true,
      ]);
      expect(client.functions.map((f) => f.jvm?.name)).not.toContainEqual(
        expect.stringMatching(/\$default$/),
      );
    });

    it("records nullability, platform types, variance and star projections", () => {
      const client = klass("SearchClient");

      expect(property(client, "lastQuery").type).toEqual(nullable(cls("kotlin/String")));
      expect(fn(client, "searchNow").returnType.nullable).toBe(true);
      expect(fn(client, "best").returnType).toMatchObject({
        classifier: { typeParameter: 0 },
        nullable: true,
      });
      expect(fn(facade("ExtensionsKt"), "systemName").returnType).toMatchObject({
        classifier: { class: "kotlin/String" },
        platform: true,
      });
      expect(fn(client, "copyInto").parameters.map((p) => p.type.arguments[0])).toEqual([
        { variance: "in", type: cls(search("SearchHit")) },
        { variance: "out", type: cls(search("SearchHit")) },
        "*",
      ]);
      expect(fn(client, "onResult").parameters[0]!.type).toMatchObject({
        classifier: { class: "kotlin/Function2" },
        suspend: true,
      });
      expect(klass("Page").typeParameters).toEqual([
        { id: 0, name: "T", variance: "out", upperBounds: [] },
      ]);
    });

    it("records type annotations: a function type's receiver, a compiler plugin's", () => {
      const [block] = fn(facade("ExtensionsKt"), "using").parameters;

      expect(block!.type).toMatchObject({
        classifier: { class: "kotlin/Function1" },
        annotations: [search("Marked"), "kotlin/ExtensionFunctionType"],
      });
      expect(fn(facade("ExtensionsKt"), "systemName").returnType).not.toHaveProperty("annotations");
    });

    it("describes a value class by its underlying property", () => {
      const hitId = klass("HitId");

      expect(hitId).toMatchObject({
        value: true,
        valueClass: { property: "raw", type: cls("kotlin/Long") },
      });
      expect(hitId.constructors[0]!.jvm).toEqual({ name: "constructor-impl", descriptor: "(J)J" });
      expect(fn(klass("BaseSource"), "load")).toMatchObject({
        visibility: "protected",
        jvm: { name: "load-X6dG1pw", descriptor: "(J)Ldev/orbit/search/SearchHit;" },
      });
    });

    it("lists the subclasses of sealed classes and interfaces", () => {
      expect(klass("SearchResult")).toMatchObject({
        kind: "interface",
        modality: "sealed",
        sealedSubclasses: [
          "dev/orbit/search/SearchResult.Empty",
          "dev/orbit/search/SearchResult.Failed",
          "dev/orbit/search/SearchResult.Found",
        ],
      });
      expect(klass("SearchResult$Empty")).toMatchObject({ kind: "object", data: true });
      expect(klass("Filter")).toMatchObject({
        modality: "sealed",
        sealedSubclasses: ["dev/orbit/search/Filter.All", "dev/orbit/search/Filter.Prefix"],
      });
      expect(klass("Filter").constructors[0]!.visibility).toBe("protected");
    });

    it("keeps extension receivers apart from parameters and first on the JVM", () => {
      const extensions = facade("ExtensionsKt");

      expect(fn(extensions, "toQuery")).toMatchObject({
        receiver: cls("kotlin/String"),
        parameters: [{ name: "limit", declaresDefault: true }],
        jvm: { name: "toQuery", descriptor: "(Ljava/lang/String;I)Ljava/lang/String;" },
      });
      expect(fn(extensions, "first")).toMatchObject({
        suspend: true,
        receiver: cls(search("SearchClient")),
        jvm: {
          descriptor:
            "(Ldev/orbit/search/SearchClient;Ljava/lang/String;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;",
        },
      });
      expect(property(extensions, "shortTitle")).toMatchObject({
        receiver: cls(search("SearchHit")),
        getter: {
          jvm: {
            name: "getShortTitle",
            descriptor: "(Ldev/orbit/search/SearchHit;)Ljava/lang/String;",
          },
        },
      });
      expect(property(extensions, "marker").setter!.jvm).toEqual({
        name: "setMarker",
        descriptor: "(Ljava/lang/StringBuilder;C)V",
      });
    });

    it("reads top-level declarations from file facades and multi-file facades", () => {
      expect(facade("ExtensionsKt").functions.map((f) => f.name)).toEqual([
        "defaultClient",
        "toQuery",
        "first",
        "id",
        "firstOf",
        "systemName",
        "using",
      ]);
      expect(declaration("Queries")).toMatchObject({
        parts: [search("Queries__QueriesLimitsKt"), search("Queries__QueriesTextKt")],
      });
      expect(declaration("Queries__QueriesLimitsKt")).toMatchObject({
        facade: search("Queries"),
        functions: [
          {
            name: "clampLimit",
            parameters: [{ name: "limit", type: nullable(cls("kotlin/Int")) }],
            jvm: { name: "clampLimit", descriptor: "(Ljava/lang/Integer;)I" },
          },
        ],
      });
    });

    it("reads properties with their accessors and backing fields", () => {
      const client = klass("SearchClient");
      const extensions = facade("ExtensionsKt");

      expect(property(client, "pageSize")).toMatchObject({
        mutable: true,
        getter: { jvm: { name: "getPageSize", descriptor: "()I" } },
        setter: { jvm: { name: "setPageSize", descriptor: "(I)V" } },
        field: { name: "pageSize", descriptor: "I" },
      });
      expect(property(client, "session")).toMatchObject({ mutable: true, lateinit: true });
      expect(property(client, "lastQuery")).toMatchObject({ mutable: true });
      expect(property(client, "lastQuery")).not.toHaveProperty("setter");
      expect(property(extensions, "MAX_LIMIT")).toMatchObject({
        const: true,
        field: { name: "MAX_LIMIT", descriptor: "I" },
      });
      expect(property(extensions, "MAX_LIMIT").getter).not.toHaveProperty("jvm");
      expect(property(extensions, "VERSION").getter.jvm).toEqual({
        name: "getVERSION",
        descriptor: "()Ljava/lang/String;",
      });
    });

    it("describes companions, enums, annotations, fun and inner classes", () => {
      expect(klass("SearchClient").companionObject).toBe("Companion");
      expect(klass("SearchClient$Companion")).toMatchObject({
        kind: "companion",
        functions: [{ name: "create" }],
        properties: [{ name: "DEFAULT_LIMIT", const: true }],
      });
      expect(klass("Mode")).toMatchObject({ kind: "enum", enumEntries: ["FAST", "EXACT"] });
      expect(klass("Experimental").kind).toBe("annotation");
      expect(klass("HitFilter")).toMatchObject({ kind: "interface", fun: true });
      expect(klass("SearchClient$Cursor")).toMatchObject({ inner: true });
      expect(klass("SearchHit")).toMatchObject({ data: true });
      expect(fn(klass("SearchHit"), "copy").memberKind).toBe("synthesized");
      expect(fn(klass("SearchClient"), "reset").jvm!.name).toBe("resetAll");
    });

    it("leaves out private and internal declarations", () => {
      const names = batch().inputs[0]!.declarations.map((d) => d.jvmName);
      const client = klass("SearchClient");
      const extensions = facade("ExtensionsKt");

      expect(names).not.toContain(search("InternalThing"));
      expect(names).not.toContain(search("PrivateThing"));
      expect(client.functions.map((f) => f.name)).not.toContain("internalHelper");
      expect(client.functions.map((f) => f.name)).not.toContain("privateHelper");
      expect(client.properties.map((p) => p.name)).not.toContain("token");
      expect(extensions.functions.map((f) => f.name)).not.toContain("hiddenHelper");
      expect(extensions.properties.map((p) => p.name)).not.toContain("secret");
    });

    it("maps each JVM method the metadata names to its source role", () => {
      const roles = jvmMemberRoles(klass("SearchClient"));

      expect(roles.get("<init>(Ljava/lang/String;Ljava/lang/String;)V")).toEqual({
        role: "constructor",
        name: "<init>",
      });
      expect(
        roles.get("search(Ljava/lang/String;ILkotlin/coroutines/Continuation;)Ljava/lang/Object;"),
      ).toEqual({
        role: "function",
        name: "search",
      });
      expect(roles.get("getPageSize()I")).toEqual({ role: "getter", name: "pageSize" });
      expect(roles.get("setPageSize(I)V")).toEqual({ role: "setter", name: "pageSize" });
      expect(
        roles.has(
          "search$default(Ldev/orbit/search/SearchClient;Ljava/lang/String;ILkotlin/coroutines/Continuation;ILjava/lang/Object;)Ljava/lang/Object;",
        ),
      ).toBe(false);
    });
  });
});
