import { describe, expect, it } from "vite-plus/test";
import {
  explainRefusal,
  ownTypes,
  planBinding,
  planConversion,
  planMember,
  takenReason,
  type TypeLookup,
  typesOf,
  unsupportedReason,
} from "../src/binding-plan.ts";
import { coverage } from "../src/coverage.ts";
import {
  loadSchema,
  parseSchemaType,
  SCHEMA_FORMAT,
  type SchemaType,
  type SdkClassSchema,
  type SdkModuleSchema,
} from "../src/schema.ts";

/** A schema type from its written form (`string?`, `Kit.KITView`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const provenance = (artifact: string) => ({
  artifact,
  kind: "sdk" as const,
  target: "arm64-apple-ios15.1-simulator",
  extractor: "0",
});

/** An Objective-C module: a class, an enum, a struct, and C functions. */
const kit = loadSchema({
  format: SCHEMA_FORMAT,
  platform: "ios",
  module: "Kit",
  provenance: provenance("sdk:iphonesimulator27.0"),
  types: [
    {
      kind: "class",
      name: "KITView",
      native: "KITView",
      symbol: "objc:c:objc(cs)KITView",
      methods: [
        {
          name: "nest",
          selector: "nest:",
          params: [{ name: "b", type: T("((((bool) => void) => void)) => void") }],
          returns: T("void"),
          symbol: "objc:c:objc(cs)KITView(im)nest:",
        },
        {
          name: "handler",
          selector: "handler",
          params: [],
          returns: T("(((bool) => void)) => void"),
        },
        {
          name: "grid",
          selector: "grid",
          params: [],
          returns: T("string[][]"),
          symbol: "objc:c:objc(cs)KITView(im)grid",
        },
        {
          name: "fill",
          selector: "fill:",
          params: [{ name: "g", type: T("string[][]") }],
          returns: T("void"),
        },
        {
          name: "report",
          selector: "report:",
          params: [{ name: "e", type: T("error") }],
          returns: T("void"),
        },
        {
          name: "enumerate",
          selector: "enumerate:",
          params: [{ name: "b", type: T("(string, Out<bool>) => void") }],
          returns: T("void"),
        },
        {
          name: "later",
          selector: "later:",
          params: [{ name: "b", type: T("@escaping (string, Out<bool>) => void") }],
          returns: T("void"),
        },
        {
          name: "measure",
          selector: "measure:",
          params: [{ name: "b", type: T("(Out<Kit.KITPoint>) => void") }],
          returns: T("void"),
        },
        {
          name: "copyLayer",
          selector: "copyLayer",
          params: [],
          returns: T("Kit.KITView"),
        },
        {
          name: "save",
          selector: "saveTo:error:",
          params: [{ name: "path", type: T("string") }],
          returns: T("bool"),
          throws: true,
        },
      ],
      properties: [
        { name: "title", type: T("string"), setter: "setTitle:" },
        { name: "bounds", type: T("Kit.KITPoint"), readonly: true },
        { name: "tag", type: T("NSInteger") },
      ],
    },
    {
      kind: "class",
      name: "KITDelegate",
      native: "KITDelegate",
      interface: true,
      methods: [
        {
          name: "didFinish",
          selector: "didFinish:stop:",
          params: [
            { name: "view", type: T("Kit.KITView") },
            { name: "stop", type: T("Out<bool>") },
          ],
          returns: T("void"),
        },
        {
          name: "shouldStart",
          selector: "shouldStart:stop:",
          params: [
            { name: "view", type: T("Kit.KITView") },
            { name: "stop", type: T("Out<bool>") },
          ],
          returns: T("bool"),
        },
      ],
    },
    {
      kind: "enum",
      name: "KITEdges",
      native: "KITEdges",
      cases: [{ name: "top", native: "KITEdgesTop", value: 1 }],
    },
    {
      kind: "struct",
      name: "KITPoint",
      native: "KITPoint",
      fields: [{ name: "x", type: T("double") }],
    },
  ],
  functions: [
    {
      name: "KITImageCreate",
      params: [{ name: "name", type: T("CFString") }],
      returns: T("CFTypeRef"),
      symbol: "c:c:@F@KITImageCreate",
    },
    { name: "KITImageGet", params: [], returns: T("CFTypeRef") },
  ],
});

const view = kit.types[0] as SdkClassSchema;
const delegate = kit.types[1] as SdkClassSchema;
const method = (cls: SdkClassSchema, name: string) => cls.methods!.find((m) => m.name === name)!;
const property = (cls: SdkClassSchema, name: string) =>
  cls.properties!.find((p) => p.name === name)!;
const lookup =
  (...schemas: SdkModuleSchema[]) =>
  (module: string) => {
    const schema = schemas.find((s) => s.module === module);
    return schema ? { schema } : { missing: `no ${module}` };
  };
const kitTypes = typesOf(kit, lookup(kit));

describe("binding plans: roles", () => {
  it("plans a property's read and its write", () => {
    const get = planMember(view, property(view, "title"), kit, lookup(kit));
    const set = planMember(view, property(view, "title"), kit, lookup(kit), "set");

    expect(get).toMatchObject({ role: "get", inputs: [], output: { op: "copy-string" } });
    expect(set).toMatchObject({
      role: "set",
      inputs: [{ op: "copy-string" }],
      output: { op: "passthrough", type: T("void") },
    });
    expect(unsupportedReason(set)).toBeUndefined();
  });

  it("refuses to write what cannot be written, naming the rule", () => {
    const bounds = planBinding(view, property(view, "bounds"), kit, kitTypes, "set");
    const tag = planBinding(view, property(view, "tag"), kit, kitTypes, "set");

    expect(bounds.refused).toEqual({ rule: "read-only", reason: "it is read-only" });
    expect(unsupportedReason(bounds)).toBe("it is read-only");
    // An Objective-C property without a setter selector.
    expect(tag.refused).toEqual({ rule: "no-setter", reason: "it has no setter" });
  });

  it("defaults the role by the member: new, call, get", () => {
    expect(planBinding(view, { params: [] }, kit, kitTypes).role).toBe("new");
    expect(planBinding(view, method(view, "grid"), kit, kitTypes).role).toBe("call");
    expect(planBinding(view, property(view, "title"), kit, kitTypes).role).toBe("get");
  });
});

describe("binding plans: Objective-C rules", () => {
  it("refuses nested collections read from Objective-C, and passes them in", () => {
    const grid = planBinding(view, method(view, "grid"), kit, kitTypes);

    expect(unsupportedReason(grid)).toBe(
      "nested collections from Objective-C are not supported yet",
    );
    expect(
      unsupportedReason(planBinding(view, method(view, "fill"), kit, kitTypes)),
    ).toBeUndefined();
  });

  it("refuses passing errors, and blocks nested three deep or read taking blocks", () => {
    expect(unsupportedReason(planBinding(view, method(view, "report"), kit, kitTypes))).toBe(
      "passing errors to Objective-C is not supported yet",
    );
    expect(unsupportedReason(planBinding(view, method(view, "nest"), kit, kitTypes))).toBe(
      "blocks that take blocks that take blocks are not supported",
    );
    expect(unsupportedReason(planBinding(view, method(view, "handler"), kit, kitTypes))).toBe(
      "blocks that take blocks cannot be called from Lucent yet",
    );
  });

  it("delivers blocks now while the platform waits, queued otherwise", () => {
    const now = planBinding(view, method(view, "enumerate"), kit, kitTypes).inputs[0]!;
    const later = planBinding(view, method(view, "later"), kit, kitTypes).inputs[0]!;

    expect(now).toMatchObject({ op: "callback", delivery: "sync" });
    expect(later).toMatchObject({ op: "callback", delivery: "queued" });
  });

  it("refuses a block's pointer only to the functions that take it", () => {
    const later = planBinding(view, method(view, "later"), kit, kitTypes);
    const measure = planBinding(view, method(view, "measure"), kit, kitTypes);
    const callback = later.inputs[0]!;

    // The member is callable: a function that leaves the pointer out works.
    expect(unsupportedReason(later)).toBeUndefined();
    expect(callback.of![1]).toMatchObject({ op: "unsupported", omissible: true });
    expect(takenReason(callback.of!.slice(0, -1), 1)).toBeUndefined();
    expect(takenReason(callback.of!.slice(0, -1), 2)).toBe(
      "a block or requirement that takes a pointer must run while the platform waits for it",
    );
    expect(takenReason(measure.inputs[0]!.of!.slice(0, -1), 1)).toBe(
      "a pointer to a struct or an object passed to Lucent code is not supported yet",
    );
  });

  it("refuses nothing a lookup cannot tell: a pointer to a type of unknown kind", () => {
    const foreign = {
      name: "foreign",
      selector: "foreign:",
      params: [{ name: "b", type: T("(Out<Other.OTHValue>) => void") }],
      returns: T("void"),
    };
    const plan = planBinding(view, foreign, kit, ownTypes(kit));

    expect(takenReason(plan.inputs[0]!.of!.slice(0, -1), 1)).toBeUndefined();
  });

  it("assigns a block to a property, and refuses blocks given back in any other place", () => {
    const handler = { name: "handler", type: T("((NSInteger) => void)?"), setter: "setHandler:" };
    const make = {
      name: "make",
      selector: "make:",
      params: [{ name: "b", type: T("() => (() => void)") }],
      returns: T("void"),
    };

    expect(unsupportedReason(planBinding(view, handler, kit, kitTypes, "set"))).toBeUndefined();
    expect(unsupportedReason(planBinding(view, make, kit, kitTypes))).toBe(
      "blocks can only be passed to Objective-C as arguments yet",
    );
  });

  it("plans a requirement a Lucent class implements: what it is given, what it gives back", () => {
    const queued = planBinding(delegate, method(delegate, "didFinish"), kit, kitTypes, "implement");
    const waited = planBinding(
      delegate,
      method(delegate, "shouldStart"),
      kit,
      kitTypes,
      "implement",
    );

    expect(queued).toMatchObject({ role: "implement", delivery: "queued" });
    expect(waited).toMatchObject({
      role: "implement",
      delivery: "sync",
      output: { op: "passthrough" },
    });
    expect(takenReason(queued.inputs, 1)).toBeUndefined();
    expect(takenReason(queued.inputs, 2)).toBe(
      "a block or requirement that takes a pointer must run while the platform waits for it",
    );
    expect(takenReason(waited.inputs, 2)).toBeUndefined();
  });

  it("says who owns a result, by Cocoa's and CoreFoundation's naming conventions", () => {
    const copy = planBinding(view, method(view, "copyLayer"), kit, kitTypes);
    const create = planBinding(undefined, kit.functions![0]!, kit, kitTypes);
    const get = planBinding(undefined, kit.functions![1]!, kit, kitTypes);

    expect(copy.facts).toMatchObject({
      ownership: "transferred",
      evidence: [{ fact: "ownership", source: "convention", detail: "objc-method-family" }],
    });
    expect(create.facts).toMatchObject({
      ownership: "transferred",
      evidence: [{ fact: "ownership", source: "convention", detail: "cf-create-rule" }],
    });
    expect(get.facts.ownership).toBe("unknown");
  });

  it("crosses native 64-bit integers as bigints, and other numbers as they are", () => {
    const one = (t: SchemaType) =>
      planConversion(t, { backend: "objc", platform: "ios", flow: "out" }, kitTypes);

    for (const wide of ["NSInteger", "NSUInteger", "int64", "uint64", "long"])
      expect(one(T(wide))).toEqual({ op: "bigint", type: T(wide), detail: wide });

    for (const narrow of ["int", "int32", "double", "CGFloat", "uint16"])
      expect(one(T(narrow))).toEqual({ op: "number", type: T(narrow), detail: narrow });
  });

  it("keeps a constant group's 64-bit integers numbers, exactly or RangeError", () => {
    const window: SchemaType = { k: "prim", name: "long", nullable: false, group: true };

    expect(
      planConversion(window, { backend: "jni", platform: "android", flow: "in" }, kitTypes),
    ).toEqual({ op: "number", type: window, detail: "long", exact: true });
  });

  it("says how a member reports failure", () => {
    expect(planBinding(view, method(view, "save"), kit, kitTypes).error).toEqual({
      op: "error",
      type: T("error"),
      detail: "nserror-out",
    });
    expect(planBinding(view, method(view, "grid"), kit, kitTypes).error).toBeUndefined();
  });

  it("explains a refusal with the declaration it comes from", () => {
    const grid = planBinding(view, method(view, "grid"), kit, kitTypes);

    expect(explainRefusal(grid)).toBe(
      "KITView.grid: nested collections from Objective-C are not supported yet (objc:c:objc(cs)KITView(im)grid in sdk:iphonesimulator27.0)",
    );
    expect(explainRefusal(planBinding(view, method(view, "fill"), kit, kitTypes))).toBeUndefined();
  });
});

describe("binding plans: JNI rules", () => {
  const pkg = loadSchema({
    format: SCHEMA_FORMAT,
    platform: "android",
    module: "com.example",
    provenance: { ...provenance("android-sdk:37"), kind: "jar", target: "android-37" },
    types: [
      {
        kind: "class",
        name: "Color",
        native: "com/example/Color",
        methods: [
          {
            name: "components",
            params: [],
            returns: T("float[]"),
            symbol: "jvm:com/example/Color#components()[F",
          },
          {
            name: "fromHsv",
            params: [{ name: "hsv", type: T("float[]") }],
            returns: T("int"),
            static: true,
          },
          { name: "bytes", params: [], returns: T("byte[]?") },
          { name: "names", params: [], returns: T("string[]") },
          { name: "labels", params: [], returns: T("CharSequence[]") },
          {
            name: "colors",
            params: [{ name: "grid", type: T("com.example.Color[][]") }],
            returns: T("void"),
          },
          {
            name: "fill",
            typeParams: ["T"],
            params: [{ name: "items", type: T("T[]", ["T"]) }],
            returns: T("void"),
          },
          { name: "items", typeParams: ["T"], params: [], returns: T("T[]", ["T"]) },
          {
            name: "keep",
            typeParams: ["T"],
            params: [{ name: "items", type: T("List<T>", ["T"]) }],
            returns: T("List<int?>"),
          },
        ],
        properties: [{ name: "left", type: T("int"), symbol: "jvm:com/example/Color#left:I" }],
      },
      {
        kind: "class",
        name: "Listener",
        native: "com/example/Listener",
        interface: true,
        functional: "onKey",
        methods: [
          {
            name: "onKey",
            abstract: true,
            params: [
              { name: "code", type: T("int") },
              { name: "key", type: T("char") },
            ],
            returns: T("void"),
          },
          { name: "describe", abstract: true, params: [], returns: T("com.example.Color") },
        ],
      },
    ],
  });
  const color = pkg.types[0] as SdkClassSchema;
  const listener = pkg.types[1] as SdkClassSchema;
  const types = typesOf(pkg, lookup(pkg));

  it("copies Java arrays of any element either way, but a type parameter's only out", () => {
    const plan = (name: string) => planBinding(color, method(color, name), pkg, types);

    expect(unsupportedReason(plan("components"))).toBeUndefined();
    expect(plan("components").output).toMatchObject({
      op: "copy-array",
      of: [{ op: "number", detail: "float" }],
    });
    expect(unsupportedReason(plan("fromHsv"))).toBeUndefined();
    expect(plan("bytes").output).toMatchObject({ of: [{ op: "copy-bytes", detail: "byte[]" }] });
    expect(unsupportedReason(plan("names"))).toBeUndefined();
    expect(unsupportedReason(plan("labels"))).toBeUndefined();
    expect(unsupportedReason(plan("colors"))).toBeUndefined();
    expect(plan("colors").inputs[0]).toMatchObject({
      op: "copy-array",
      of: [{ op: "copy-array", of: [{ op: "retain-object" }] }],
    });
    expect(unsupportedReason(plan("fill"))).toBe(
      "arrays of a type parameter's values cannot be passed to Java yet",
    );
    expect(unsupportedReason(plan("items"))).toBeUndefined();
  });

  it("copies Kotlin's read-only lists either way, a type parameter's too", () => {
    const keep = planBinding(color, method(color, "keep"), pkg, types);

    expect(unsupportedReason(keep)).toBeUndefined();
    expect(keep.inputs[0]).toMatchObject({
      op: "copy-array",
      detail: "List",
      of: [{ op: "retain-object" }],
    });
    expect(keep.output).toMatchObject({
      op: "copy-array",
      detail: "List",
      of: [{ op: "optional", of: [{ op: "number", detail: "int" }] }],
    });
  });

  it("refuses writing Java fields, and reports Java exceptions", () => {
    const set = planBinding(color, property(color, "left"), pkg, types, "set");

    expect(set.refused).toEqual({
      rule: "java-field-write",
      reason: "assigning Java fields is not supported yet",
    });
    expect(explainRefusal(set)).toBe(
      "Color.left: assigning Java fields is not supported yet (jvm:com/example/Color#left:I in android-sdk:37)",
    );
    expect(planBinding(color, method(color, "bytes"), pkg, types).error).toMatchObject({
      detail: "java-exception",
    });
  });

  it("plans interface methods Lucent implements: chars refused where taken, results boxed or objects", () => {
    const onKey = planBinding(listener, method(listener, "onKey"), pkg, types, "implement");
    const describe = planBinding(listener, method(listener, "describe"), pkg, types, "implement");

    expect(onKey.delivery).toBe("queued");
    expect(takenReason(onKey.inputs, 1)).toBeUndefined();
    expect(takenReason(onKey.inputs, 2)).toBe("a char argument is not supported yet");
    expect(describe.delivery).toBe("sync");
    expect(unsupportedReason(describe)).toBeUndefined();
  });
});

describe("binding plans: Kotlin facts", () => {
  const search = "(Ljava/lang/String;ILkotlin/coroutines/Continuation;)Ljava/lang/Object;";
  const pkg = loadSchema({
    format: SCHEMA_FORMAT,
    platform: "android",
    module: "dev.orbit",
    provenance: { ...provenance("jar:orbit.jar"), kind: "jar", target: "android-37" },
    types: [
      {
        kind: "class",
        name: "Client",
        native: "dev/orbit/Client",
        kotlin: { kind: "class" },
        methods: [
          {
            name: "search",
            params: [
              { name: "prefix", type: T("string") },
              { name: "limit", type: T("int"), kotlin: { default: true } },
            ],
            returns: T("string[]"),
            descriptor: search,
            symbol: `jvm:dev/orbit/Client#search${search}`,
            kotlin: { suspend: true },
          },
          {
            name: "configure",
            params: [{ name: "retries", type: T("int"), kotlin: { default: true } }],
            returns: T("void"),
          },
          {
            name: "id",
            params: [],
            returns: T("dev.orbit.HitId"),
            descriptor: "()J",
            kotlin: { unboxed: true },
          },
          {
            name: "onResult",
            params: [
              {
                name: "block",
                type: T("@escaping (dev.orbit.Client) => void"),
                kotlin: { suspendFunction: true },
              },
            ],
            returns: T("void"),
          },
          {
            name: "first",
            typeParams: ["T"],
            params: [
              { name: "items", type: T("T[]", ["T"]) },
              { name: "fallback", type: T("T?", ["T"]), kotlin: { default: true } },
            ],
            returns: T("T?", ["T"]),
            kotlin: { suspend: true },
          },
          {
            name: "best",
            typeParams: ["T"],
            params: [{ name: "items", type: T("List<T>", ["T"]) }],
            returns: T("T?", ["T"]),
            kotlin: {
              suspend: true,
              bounds: { T: "other" },
              upperBounds: { T: [{ name: "kotlin.Comparable", args: [{ name: "T" }] }] },
            },
          },
          {
            name: "worst",
            typeParams: ["T"],
            params: [{ name: "items", type: T("List<T>", ["T"]) }],
            returns: T("T?", ["T"]),
            kotlin: { suspend: true, bounds: { T: "other" } },
          },
        ],
        properties: [
          {
            name: "pageSize",
            type: T("int"),
            getter: "getPageSize",
            setter: "setPageSize",
            symbol: "jvm:dev/orbit/Client#getPageSize()I",
          },
          {
            name: "lastId",
            type: T("dev.orbit.HitId"),
            getter: "getLastId-6dG1pw",
            setter: "setLastId-X6dG1pw",
            kotlin: { unboxed: true },
          },
        ],
      },
      {
        kind: "class",
        name: "HitId",
        native: "dev/orbit/HitId",
        kotlin: { kind: "class", value: { property: "raw", type: T("long") } },
      },
      {
        kind: "class",
        name: "Loader",
        native: "dev/orbit/Loader",
        interface: true,
        kotlin: { kind: "interface" },
        methods: [
          {
            name: "load",
            java: "load-X6dG1pw",
            abstract: true,
            params: [{ name: "id", type: T("dev.orbit.HitId?") }],
            returns: T("void"),
          },
          {
            name: "fetch",
            abstract: true,
            params: [],
            returns: T("string"),
            kotlin: { suspend: true },
          },
        ],
      },
      {
        kind: "class",
        name: "Base",
        native: "dev/orbit/Base",
        kotlin: { kind: "class" },
        methods: [
          {
            name: "load",
            java: "load-X6dG1pw",
            abstract: true,
            params: [{ name: "id", type: T("dev.orbit.HitId?") }],
            returns: T("void"),
          },
        ],
      },
    ],
  });
  const client = pkg.types[0] as SdkClassSchema;
  const loader = pkg.types[2] as SdkClassSchema;
  const base = pkg.types[3] as SdkClassSchema;
  const types = typesOf(pkg, lookup(pkg));
  const plan = (name: string) => planBinding(client, method(client, name), pkg, types);

  it("calls suspend functions and value classes the JVM unboxes through a Kotlin shim", () => {
    expect(plan("search")).toMatchObject({
      backend: "kotlin-shim",
      symbol: `jvm:dev/orbit/Client#search${search}`,
      inputs: [{ op: "copy-string" }, { op: "number", detail: "int", omissible: true }],
      output: { op: "copy-array" },
      error: { detail: "java-exception" },
    });
    expect(plan("search").refused).toBeUndefined();
    expect(plan("id")).toMatchObject({ backend: "kotlin-shim", output: { op: "retain-object" } });
    expect(plan("id").refused).toBeUndefined();
    expect(planBinding(client, property(client, "lastId"), pkg, types).refused).toBeUndefined();
  });

  it("calls generic members through a shim, with Lucent functions as suspend functions", () => {
    expect(plan("first")).toMatchObject({ backend: "kotlin-shim" });
    expect(plan("first").refused).toBeUndefined();
    // Kotlin waits for a suspend function: the Lucent function runs while it does.
    expect(plan("onResult")).toMatchObject({
      backend: "kotlin-shim",
      inputs: [{ op: "callback", delivery: "sync", of: [{ op: "retain-object" }, {}] }],
    });
    expect(plan("onResult").refused).toBeUndefined();
  });

  it("calls bounded generics, assigns value classes and implements interfaces' Kotlin members", () => {
    expect(plan("best")).toMatchObject({ backend: "kotlin-shim" });
    expect(plan("best").refused).toBeUndefined();
    expect(planBinding(client, property(client, "lastId"), pkg, types, "set")).toMatchObject({
      backend: "kotlin-shim",
      inputs: [{ op: "retain-object" }],
    });
    expect(
      planBinding(client, property(client, "lastId"), pkg, types, "set").refused,
    ).toBeUndefined();
    for (const name of ["fetch", "load"])
      expect(
        planBinding(loader, method(loader, name), pkg, types, "implement").refused,
      ).toBeUndefined();
  });

  it("refuses what the shims do not handle yet, naming the rule", () => {
    expect(plan("worst").refused).toEqual({
      rule: "kotlin-shim-generic",
      reason:
        "generic Kotlin members bounded by a projected type (`T : List<out R>`) are not supported through a shim yet",
    });
    expect(explainRefusal(plan("worst"))).toBe(
      "Client.worst: generic Kotlin members bounded by a projected type (`T : List<out R>`) are not supported through a shim yet (in jar:orbit.jar)",
    );
  });

  it("lets a call leave out Kotlin defaults, which a shim omits, unless it cannot write the bounds", () => {
    expect(plan("configure")).toMatchObject({
      backend: "jni",
      inputs: [{ op: "number", detail: "int", omissible: true }],
    });
    expect(plan("configure").refused).toBeUndefined();
    expect(plan("first").inputs[1]).toMatchObject({ omissible: true });
  });

  it("writes Kotlin properties through their setters, and refuses overriding mangled names", () => {
    const set = planBinding(client, property(client, "pageSize"), pkg, types, "set");
    const load = planBinding(base, method(base, "load"), pkg, types, "implement");

    expect(set).toMatchObject({ backend: "jni", inputs: [{ op: "number", detail: "int" }] });
    expect(set.refused).toBeUndefined();
    // A class's override is Java source; an interface's implementation is a proxy, by any name.
    expect(load.refused).toEqual({
      rule: "jvm-mangled-name",
      reason: "a method whose JVM name Java cannot write (load-X6dG1pw) cannot be overridden",
    });
    expect(
      planBinding(loader, method(loader, "load"), pkg, types, "implement").refused,
    ).toBeUndefined();
  });
});

describe("binding plans: Swift rules", () => {
  const shapes = loadSchema({
    format: SCHEMA_FORMAT,
    platform: "ios",
    module: "Shapes",
    types: [
      {
        kind: "class",
        name: "Pen",
        native: "Shapes.Pen",
        swift: { kind: "struct" },
        constructors: [
          { params: [], swift: { name: "init()", async: true } },
          { params: [{ name: "width", type: T("double") }], swift: { name: "init(width:)" } },
        ],
        methods: [
          {
            name: "width",
            params: [{ name: "at", type: T("double?") }],
            returns: T("double"),
            swift: { name: "width(at:)" },
          },
          {
            name: "style",
            params: [],
            returns: T("Kit.KITEdges"),
            swift: { name: "style()" },
          },
          {
            name: "each",
            params: [{ name: "f", type: T("(double) => void") }],
            returns: T("void"),
            swift: { name: "each(_:)" },
          },
          {
            name: "visit",
            params: [{ name: "f", type: T("(Shapes.Outline) => void") }],
            returns: T("void"),
            swift: { name: "visit(_:)" },
          },
          {
            name: "outline",
            params: [{ name: "o", type: T("Shapes.Outline?") }],
            returns: T("void"),
            swift: { name: "outline(_:)" },
          },
          {
            name: "current",
            params: [],
            returns: T("Shapes.Outline?"),
            swift: { name: "current()" },
          },
          {
            name: "sizes",
            params: [],
            returns: T("double?[]"),
            swift: { name: "sizes()" },
          },
          {
            name: "listed",
            params: [],
            returns: T("Tuple<double[], string>"),
            swift: { name: "listed()" },
          },
          {
            name: "measured",
            params: [],
            returns: T("Tuple<NSData, string>"),
            swift: { name: "measured()" },
          },
          {
            name: "draw",
            params: [{ name: "o", type: T("Shapes.Outline") }],
            returns: T("void"),
            swift: { name: "draw(_:)" },
          },
          {
            name: "fill",
            params: [{ name: "c", type: T("Shapes.Container<string>") }],
            returns: T("void"),
            swift: { name: "fill(_:)" },
          },
          {
            name: "any",
            params: [{ name: "c", type: T("Shapes.Container") }],
            returns: T("void"),
            swift: { name: "any(_:)" },
          },
          {
            name: "bag",
            params: [],
            returns: T("Shapes.Container<string>"),
            swift: { name: "bag()" },
          },
        ],
      },
      {
        kind: "class",
        name: "Outline",
        native: "Shapes.Outline",
        swift: {
          kind: "enum",
          cases: [
            { name: "none", params: [] },
            { name: "dashed", params: [{ type: T("double") }] },
          ],
        },
      },
      {
        kind: "class",
        name: "Container",
        native: "Shapes.Container",
        interface: true,
        typeParams: ["Item"],
        swift: { kind: "protocol", associatedTypes: true, primaryAssociatedTypes: ["Item"] },
        methods: [
          { name: "count", params: [], returns: T("NSInteger"), swift: { name: "count()" } },
        ],
      },
      {
        kind: "class",
        name: "Drawable",
        native: "Shapes.Drawable",
        interface: true,
        swift: { kind: "protocol" },
        properties: [
          { name: "name", type: T("string"), readonly: true, swift: { name: "name" } },
          { name: "size", type: T("double"), swift: { name: "size" } },
          { name: "ready", type: T("bool"), readonly: true, swift: { name: "ready", async: true } },
        ],
        methods: [
          {
            name: "render",
            params: [],
            returns: T("void"),
            swift: { name: "render()", async: true },
          },
          {
            name: "check",
            params: [],
            returns: T("void"),
            swift: { name: "check()", throws: true },
          },
          {
            name: "make",
            params: [],
            returns: T("Shapes.Drawable"),
            static: true,
            swift: { name: "make()" },
          },
        ],
      },
    ],
  });
  const pen = shapes.types[0] as SdkClassSchema;
  const types = typesOf(shapes, lookup(shapes, kit));
  const reason = (cls: SdkClassSchema, name: string, role?: "implement") =>
    unsupportedReason(planBinding(cls, method(cls, name), shapes, types, role));

  it("refuses what cannot cross to Swift, as the call would, and takes closures blocks can be", () => {
    expect(reason(pen, "width")).toBe("optional numbers and booleans cannot cross to Swift yet");
    expect(reason(pen, "style")).toBe("Objective-C enums (KITEdges) cannot cross to Swift yet");
    expect(reason(pen, "each")).toBeUndefined();
    expect(reason(pen, "visit")).toBe(
      "closures taking or giving values other than numbers, booleans, strings and Objective-C objects cannot cross to Swift yet",
    );
    expect(reason(pen, "sizes")).toBe("collections of optional values cannot cross to Swift yet");
    // A tuple crosses as an array of its items' objects, which the glue reads one by one.
    expect(reason(pen, "listed")).toBe(
      "tuples of collections or closures cannot cross to Swift yet",
    );
    expect(reason(pen, "measured")).toBeUndefined();
    // An optional enum with payloads: passed in, not read out.
    expect(reason(pen, "outline")).toBe(
      "optional Swift enums with payloads cannot cross to Swift yet",
    );
    expect(reason(pen, "current")).toBeUndefined();
    expect(planBinding(pen, method(pen, "draw"), shapes, types).inputs[0]).toMatchObject({
      op: "tagged-union",
    });
  });

  it("refuses members that cannot be called or implemented, naming the rule", () => {
    const container = shapes.types[2] as SdkClassSchema;
    const drawable = shapes.types[3] as SdkClassSchema;

    expect(planBinding(pen, pen.constructors![0]!, shapes, types).refused).toEqual({
      rule: "async-initializer",
      reason: "an async initializer cannot be a constructor",
    });
    expect(
      unsupportedReason(planBinding(pen, pen.constructors![1]!, shapes, types)),
    ).toBeUndefined();
    expect(planBinding(container, method(container, "count"), shapes, types).refused).toEqual({
      rule: "associated-types",
      reason: "members of protocols with associated types cannot be called yet",
    });
    expect(
      planBinding(drawable, method(drawable, "make"), shapes, types, "implement").refused,
    ).toEqual({
      rule: "static-requirement",
      reason:
        "static requirements cannot be implemented by Lucent classes (Swift would call them without an object)",
    });
    const ready = drawable.properties![2]!;
    expect(planBinding(drawable, ready, shapes, types, "implement").refused).toEqual({
      rule: "requirement-effects",
      reason: "async or throwing property requirements cannot be implemented by Lucent classes",
    });
  });

  it("plans async, throwing and property requirements a Lucent class implements", () => {
    const drawable = shapes.types[3] as SdkClassSchema;
    const implement = (m: Parameters<typeof planBinding>[1]) =>
      planBinding(drawable, m, shapes, types, "implement");

    // Swift never waits for an async requirement: its result comes later.
    expect(implement(method(drawable, "render"))).toMatchObject({ delivery: "queued" });
    expect(implement(method(drawable, "render")).refused).toBeUndefined();
    // A throwing one's error comes back from the call, while Swift waits.
    expect(implement(method(drawable, "check"))).toMatchObject({
      delivery: "sync",
      error: { detail: "swift-throws" },
    });
    // Properties: read (and written, when they can be) while Swift waits.
    const [name, size] = drawable.properties!;
    expect(implement(name!)).toMatchObject({
      delivery: "sync",
      inputs: [],
      output: { op: "copy-string" },
    });
    expect(implement(size!)).toMatchObject({
      delivery: "sync",
      inputs: [{ op: "number" }],
      output: { op: "number" },
    });
  });

  it("passes values of protocols with associated types as arguments naming them", () => {
    expect(reason(pen, "fill")).toBeUndefined();
    expect(reason(pen, "any")).toBe(
      "Container values whose associated types the argument does not name cannot cross to Swift yet",
    );
    expect(reason(pen, "bag")).toBe(
      "Container values other than arguments (a protocol with associated types or Self requirements) cannot cross to Swift yet",
    );
  });

  it("refuses a default argument only to the calls that give it", () => {
    const tint = {
      name: "tint",
      params: [
        { name: "color", type: T("double") },
        { name: "styles", type: T("Set<string>"), defaulted: "optional" as const },
      ],
      returns: T("void"),
      swift: { name: "tint(color:styles:)" },
    };
    const plan = planBinding(pen, tint, shapes, types);

    expect(unsupportedReason(plan)).toBeUndefined();
    expect(plan.inputs[1]).toMatchObject({ op: "unsupported", omissible: true });
    expect(takenReason(plan.inputs, 1)).toBeUndefined();
    expect(takenReason(plan.inputs, 2)).toBe("set values cannot cross to Swift yet");
  });

  it("judges one value, as a use specialized with type arguments passes it", () => {
    const one = (s: string, flow: "in" | "out") =>
      planConversion(T(s), { backend: "swift-shim", platform: "ios", flow }, types);

    expect(one("NSInteger", "in")).toMatchObject({ op: "bigint", detail: "NSInteger" });
    expect(one("bool?", "out")).toMatchObject({
      op: "unsupported",
      reason: "optional numbers and booleans cannot cross to Swift yet",
    });
  });
});

describe("coverage from binding plans", () => {
  it("counts members every use of which is refused as unrepresentable, with the plan's reason", () => {
    const c = coverage(kit, kitTypes);

    // grid, report, nest, handler: refused; enumerate, later, measure: callable by a function
    // leaving the pointer out.
    expect(c.reasons).toEqual({
      "nested collections from Objective-C are not supported yet": 1,
      "passing errors to Objective-C is not supported yet": 1,
      "blocks that take blocks that take blocks are not supported": 1,
      "blocks that take blocks cannot be called from Lucent yet": 1,
    });
    expect(c.unrepresentable).toBe(4);
    expect(c.total).toBe(c.idiomatic + c.raw + c.unrepresentable);
  });

  it("plans with what the module itself declares when given no lookup", () => {
    const types: TypeLookup = () => undefined;

    expect(coverage(kit).unrepresentable).toBe(coverage(kit, kitTypes).unrepresentable);
    // A lookup that declares nothing refuses every reference.
    expect(
      coverage(kit, types).reasons["refers to Kit.KITView, which is not declared"],
    ).toBeGreaterThan(0);
  });
});
