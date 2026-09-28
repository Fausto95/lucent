import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { extractAndroid } from "../src/android.ts";
import { parseSchemaType } from "../src/schema.ts";
import { flagsNotFromFacts } from "./thread-flags.ts";

/** A schema type from its written form (`string?`, `Widgets.WDGWidget`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const javac =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;

/** The fixture sources compiled into a jar, as android.jar is. */
function fixtureJar(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-bindgen-"));
  const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], {
    encoding: "utf8",
  })
    .stdout.trim()
    .split("\n");
  const classes = path.join(dir, "classes");
  const cc = spawnSync("javac", ["--release", "11", "-d", classes, ...sources], {
    encoding: "utf8",
  });
  if (cc.status !== 0) throw new Error(cc.stderr);

  // android.jar declares java.lang.Object; only a patch of java.base compiles one.
  const object = path.join(fixtures, "jdk", "java", "lang", "Object.java");
  const oc = spawnSync(
    "javac",
    ["--patch-module", `java.base=${path.join(fixtures, "jdk")}`, "-d", classes, object],
    { encoding: "utf8" },
  );
  if (oc.status !== 0) throw new Error(oc.stderr);

  // A Kotlin-mangled JVM name, which only kotlinc writes; same length, so the constant pool stays valid.
  const mangled = path.join(classes, "com/example/widgets/UArraySorting.class");
  fs.writeFileSync(
    mangled,
    Buffer.from(
      fs.readFileSync(mangled).toString("latin1").replace("sortArray$4UcCI2c", "sortArray-4UcCI2c"),
      "latin1",
    ),
  );
  const jar = path.join(dir, "fixture.jar");
  const j = spawnSync("jar", ["cf", jar, "-C", classes, "."], { encoding: "utf8" });
  if (j.status !== 0) throw new Error(j.stderr);
  return jar;
}

/** The fixture annotations as the SDK ships them: data/annotations.zip, one XML per package. */
function annotationsZip(): string {
  const zip = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lucent-annotations-")),
    "annotations.zip",
  );
  const j = spawnSync("jar", ["cfM", zip, "-C", path.join(fixtures, "annotations"), "."], {
    encoding: "utf8",
  });
  if (j.status !== 0) throw new Error(j.stderr);
  return zip;
}

describe.skipIf(!javac)("Android extractor", () => {
  const jar = javac ? fixtureJar() : "";
  const annotations = javac ? annotationsZip() : "";
  const modules = javac
    ? extractAndroid({
        jars: [jar],
        apiVersions: path.join(fixtures, "api-versions.xml"),
        annotations,
        packages: [
          "com.example.widgets",
          "com.example.base",
          "com.example.decl",
          "com.example.tasks",
          "com.google.android.gms.tasks",
          "com.google.common.util.concurrent",
        ],
      })
    : [];
  const mod = (name: string) => modules.find((m) => m.module === name)!;
  const cls = (m: string, name: string) => {
    const t = mod(m).types.find((x) => x.name === name);
    if (t?.kind !== "class") throw new Error(`no class ${name}`);
    return t;
  };
  const widget = () => cls("com.example.widgets", "Widget");

  it("reads public classes, interfaces and nested classes with their JNI names", () => {
    expect(mod("com.example.widgets").platform).toBe("android");
    expect(widget()).toMatchObject({
      native: "com/example/widgets/Widget",
      implements: ["com.example.base.Shape"],
      since: 21,
    });
    expect(cls("com.example.base", "Shape")).toMatchObject({
      native: "com/example/base/Shape",
      interface: true,
    });
    expect(cls("com.example.widgets", "Widget_Config")).toMatchObject({
      native: "com/example/widgets/Widget$Config",
    });
    expect(cls("com.example.widgets", "Widget_Listener")).toMatchObject({ abstract: true });
    // An abstract class keeps its constructor: a Lucent subclass calls it.
    expect(
      cls("com.example.widgets", "Widget_Listener").constructors?.map((c) => c.params),
    ).toEqual([[]]);
  });

  it("marks abstract methods, and interfaces with one (which functions implement)", () => {
    const onEvent = cls("com.example.widgets", "OnEvent");
    expect(onEvent).toMatchObject({ interface: true, functional: "onEvent" });
    expect(onEvent.methods!.find((m) => m.name === "onEvent")).toMatchObject({
      abstract: true,
      params: [{ type: T("string") }, { type: T("int") }],
    });
    expect(onEvent.methods!.find((m) => m.name === "reset")).not.toHaveProperty("abstract");
    expect(cls("com.example.widgets", "Watcher")).not.toHaveProperty("functional");
    expect(cls("com.example.widgets", "Widget_Listener").methods![0]).toMatchObject({
      name: "onChange",
      abstract: true,
    });
  });

  it("reads the permissions methods require from the SDK's annotations.zip", () => {
    const setValue = widget().methods!.find(
      (m) => m.name === "setValue" && m.descriptor === "(I)V",
    );
    expect(setValue).toMatchObject({ permissions: ["android.permission.VIBRATE"] });
    expect(widget().methods!.find((m) => m.name === "touch")).toMatchObject({
      permissions: [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
      ],
    });
    expect(widget().methods!.find((m) => m.name === "area")).not.toHaveProperty("permissions");
  });

  it("reads thread annotations: main-only classes and methods, any-thread ones, worker ones", () => {
    const methods = widget().methods!;
    // @UiThread on the class: every member is main-only but those marked @AnyThread.
    expect(widget().mainActor).toBe(true);
    expect(methods.find((m) => m.name === "area")).toMatchObject({ mainActor: false });
    // @WorkerThread: blocking work, for its getter's property too.
    expect(methods.find((m) => m.name === "getName")).toMatchObject({ worker: true });
    expect(widget().properties!.find((p) => p.name === "name")).toMatchObject({ worker: true });
    expect(cls("com.example.widgets", "Widget_Listener").mainActor).toBe(true);
    // @MainThread on one method.
    const gauge = cls("com.example.widgets", "Gauge");
    expect(gauge.mainActor).toBeUndefined();
    expect(gauge.methods!.find((m) => m.name === "setUnit")).toMatchObject({ mainActor: true });
  });

  it("records what thread annotations prove as facts, with the annotation as evidence", () => {
    const methods = widget().methods!;
    const worker = {
      affinity: "worker",
      blocking: "unknown",
      ownership: "unknown",
      evidence: [{ fact: "affinity", source: "annotation", detail: "@WorkerThread" }],
    };

    // @WorkerThread: where it runs, not proof that it blocks.
    expect(methods.find((m) => m.name === "getName")!.facts).toEqual(worker);
    expect(widget().properties!.find((p) => p.name === "name")!.facts).toEqual(worker);
    expect(widget().facts).toMatchObject({
      affinity: "main",
      evidence: [{ fact: "affinity", source: "annotation", detail: "@UiThread" }],
    });
    expect(methods.find((m) => m.name === "area")!.facts).toMatchObject({ affinity: "any" });
    expect(
      cls("com.example.widgets", "Gauge").methods!.find((m) => m.name === "setUnit")!.facts,
    ).toMatchObject({
      affinity: "main",
      evidence: [{ fact: "affinity", source: "annotation", detail: "@MainThread" }],
    });

    // Unannotated: no facts of its own (its class's hold), never a guess.
    expect(methods.find((m) => m.name === "touch")).not.toHaveProperty("facts");
    expect(cls("com.example.widgets", "Watcher")).not.toHaveProperty("facts");
  });

  it("derives the thread flags and the facts together, so they cannot disagree", () => {
    expect(flagsNotFromFacts(modules)).toEqual([]);
  });

  it("keeps public constructors with exact descriptors", () => {
    expect(widget().constructors).toEqual([
      { params: [], descriptor: "()V", symbol: "jvm:com/example/widgets/Widget#<init>()V" },
      {
        params: [{ name: "arg0", type: T("string") }],
        descriptor: "(Ljava/lang/String;)V",
        symbol: "jvm:com/example/widgets/Widget#<init>(Ljava/lang/String;)V",
      },
    ]);
  });

  it("identifies declarations by their JVM names and descriptors, not their Lucent names", () => {
    const widgets = mod("com.example.widgets");
    const method = (name: string, descriptor: string) =>
      widget().methods!.find((m) => (m.java ?? m.name) === name && m.descriptor === descriptor)!;
    const property = (name: string) => widget().properties!.find((p) => p.name === name)!;

    expect(widget().symbol).toBe("jvm:com/example/widgets/Widget");
    expect(cls("com.example.widgets", "Widget_Config").symbol).toBe(
      "jvm:com/example/widgets/Widget$Config",
    );
    expect(widgets.types.find((t) => t.name === "Mode")!.symbol).toBe(
      "jvm:com/example/widgets/Mode",
    );

    // Overloads renamed for TypeScript keep the method they call.
    expect(method("setValue", "(J)V")).toMatchObject({
      name: "setValue_long",
      symbol: "jvm:com/example/widgets/Widget#setValue(J)V",
    });
    expect(method("setValue", "(I)V").symbol).toBe("jvm:com/example/widgets/Widget#setValue(I)V");

    // Generic methods: the erased descriptor, the one JNI calls.
    expect(method("get", "(Ljava/lang/Class;)Ljava/lang/Object;").symbol).toBe(
      "jvm:com/example/widgets/Widget#get(Ljava/lang/Class;)Ljava/lang/Object;",
    );

    // Fields by name and descriptor; a getter's property is its getter.
    expect(property("KIND_SMALL").symbol).toBe("jvm:com/example/widgets/Widget#KIND_SMALL:I");
    expect(property("name").symbol).toBe(
      "jvm:com/example/widgets/Widget#getName()Ljava/lang/String;",
    );

    // Every declaration has one, and no two share one (a getter's property is its getter).
    const declarations = widgets.types.flatMap((t): { symbol?: string }[] =>
      t.kind === "class"
        ? [
            t,
            ...(t.constructors ?? []),
            ...(t.methods ?? []),
            ...(t.properties ?? []).filter((p) => !p.getter),
          ]
        : [t],
    );
    const symbols = declarations.map((d) => d.symbol);

    expect(symbols.every((x) => x?.startsWith("jvm:"))).toBe(true);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("keeps a generic class's members on the class that declares them", () => {
    const result = cls("com.example.tasks", "Result");
    const lookup = cls("com.example.tasks", "Lookup");

    expect(result.methods!.find((m) => m.name === "map")!.symbol).toBe(
      "jvm:com/example/tasks/Result#map(Lcom/example/tasks/Mapper;)Lcom/example/tasks/Result;",
    );
    // Lookup<K> extends Task<K>: Task's members stay Task's, not copied under Lookup's name.
    expect(lookup.methods!.map((m) => m.symbol)).toEqual([
      "jvm:com/example/tasks/Lookup#find(Ljava/lang/String;)Lcom/google/android/gms/tasks/Task;",
      "jvm:com/example/tasks/Lookup#later()Lcom/google/common/util/concurrent/ListenableFuture;",
    ]);
  });

  it("maps nullability annotations, strict by default", () => {
    const m = (name: string) => widget().methods!.find((x) => x.name === name)!;
    expect(m("getName").returns).toEqual(T("string"));
    expect(m("getLabel")).toMatchObject({ returns: T("string?"), since: 29 });
    expect(m("getURL").returns).toEqual(T("string?"));
    expect(m("touch").params.map((p) => p.type)).toEqual(
      ["com.example.base.Shape", "com.example.widgets.Widget?"].map((x) => T(x)),
    );
    expect(m("create")).toMatchObject({
      static: true,
      params: [{ type: T("long[]?") }, { type: T("int") }],
      returns: T("com.example.widgets.Widget"),
      descriptor: "([JI)Lcom/example/widgets/Widget;",
    });
    expect(m("getBytes").returns).toEqual(T("byte[]?"));
    expect(m("old").deprecated).toBe(true);
    // CharSequence is a string at the boundary, as String is.
    expect(m("getTitle")).toMatchObject({
      returns: T("CharSequence"),
      descriptor: "()Ljava/lang/CharSequence;",
    });
    expect(m("setTitle").params[0]!.type).toEqual(T("CharSequence?"));
  });

  it("types generic methods with their exact erasure", () => {
    const m = (name: string) => widget().methods!.find((x) => x.name === name)!;
    expect(m("get")).toMatchObject({
      typeParams: ["T"],
      params: [{ type: T("Class<T>") }],
      returns: T("T?", ["T"]),
      descriptor: "(Ljava/lang/Class;)Ljava/lang/Object;",
    });
    expect(m("shape")).toMatchObject({
      typeParams: ["T"],
      returns: T("T?", ["T"]),
      descriptor: "(Ljava/lang/Class;)Lcom/example/base/Shape;",
    });
  });

  it("renames overloads that TypeScript cannot tell apart", () => {
    const sets = widget().methods!.filter(
      (x) => x.java === "setValue" || x.name.startsWith("setValue"),
    );
    expect(sets.map((x) => [x.name, x.descriptor])).toEqual([
      ["setValue", "(I)V"],
      ["setValue_long", "(J)V"],
      ["setValue", "(Ljava/lang/String;)V"],
    ]);
    expect(sets[1]!.java).toBe("setValue");
    // JavaScript numbers go to int first, whatever the descriptor order.
    const puts = widget().methods!.filter((x) => (x.java ?? x.name) === "put");
    expect(puts.map((x) => [x.name, x.descriptor])).toEqual([
      ["put_byte", "(B)V"],
      ["put", "(I)V"],
    ]);
  });

  it("exposes constants as values, fields and getters as properties", () => {
    const p = (name: string) => widget().properties!.find((x) => x.name === name);
    expect(p("KIND_SMALL")).toMatchObject({
      static: true,
      readonly: true,
      type: T("int"),
      value: 1,
      since: 24,
    });
    expect(p("DEFAULT_NAME")).toMatchObject({
      static: true,
      readonly: true,
      type: T("string"),
      value: "widget",
    });
    expect(p("counter")).toMatchObject({ static: true, readonly: false, type: T("int") });
    expect(p("name")).toMatchObject({ readonly: true, getter: "getName", type: T("string") });
    expect(p("enabled")).toMatchObject({ getter: "isEnabled", type: T("boolean") });
    expect(p("url")).toMatchObject({ getter: "getURL", type: T("string?") });
    expect(p("label")).toMatchObject({ getter: "getLabel", since: 29 });
    expect(cls("com.example.widgets", "Widget_Config").properties).toEqual([
      {
        name: "TIMEOUT",
        static: true,
        readonly: true,
        type: T("long"),
        // A long's value as its decimal digits: exact, which a number is not beyond 2^53.
        value: "30",
        symbol: "jvm:com/example/widgets/Widget$Config#TIMEOUT:J",
      },
      {
        name: "NEVER",
        static: true,
        readonly: true,
        type: T("long"),
        value: "9223372036854775807",
        symbol: "jvm:com/example/widgets/Widget$Config#NEVER:J",
      },
    ]);
  });

  it("keeps a @LongDef group's longs numbers, and makes the other longs bigints", () => {
    const gauge = cls("com.example.widgets", "Gauge");
    const m = (name: string) => gauge.methods!.find((x) => x.name === name)!;
    const p = (name: string) => gauge.properties!.find((x) => x.name === name);
    const grouped = { ...T("long"), group: true };

    expect(m("setWindow").params[0]!.type).toEqual(grouped);
    expect(p("WINDOW_LONG")).toMatchObject({ type: grouped, value: 60000 });
    expect(m("elapsed").returns).toEqual(T("long"));
  });

  it("leaves out what cannot be typed yet, and says so", () => {
    expect(widget().methods!.some((x) => x.name === "names" || x.name === "secret")).toBe(false);
    expect(mod("com.example.widgets").skipped).toContain(
      "com.example.widgets.Widget.names()Ljava/util/List;: java.util.List",
    );
  });

  it("leaves out Kotlin-mangled methods, whose names are not identifiers", () => {
    expect(cls("com.example.widgets", "UArraySorting").methods!.map((x) => x.name)).toEqual([
      "sort$all",
    ]);
    expect(mod("com.example.widgets").skipped).toContain(
      "com.example.widgets.UArraySorting.sortArray-4UcCI2c([BII)V: Kotlin-mangled name",
    );
  });

  it("gives generic classes their type parameters, and references their type arguments", () => {
    const result = cls("com.example.tasks", "Result");
    expect(result.typeParams).toEqual(["T"]);
    const m = (name: string) => result.methods!.find((x) => x.name === name)!;
    // Unannotated: nullable, as other references.
    expect(m("get").returns).toEqual(T("T?", ["T"]));
    // `? super T` and `? extends R` are T and R where Lucent takes and gives them.
    expect(m("onDone")).toMatchObject({
      params: [{ type: T("com.example.tasks.Listener<T>", ["T"]) }],
      returns: T("com.example.tasks.Result<T>", ["T"]),
    });
    expect(m("map")).toMatchObject({
      typeParams: ["R"],
      params: [{ type: T("com.example.tasks.Mapper<T, R>", ["T", "R"]) }],
      returns: T("com.example.tasks.Result<R>", ["R"]),
    });
    expect(m("of")).toMatchObject({ static: true, typeParams: ["V"] });
    const listener = cls("com.example.tasks", "Listener");
    expect(listener).toMatchObject({ typeParams: ["T"], functional: "onDone" });
    expect(listener.methods![0]!.params[0]!.type).toEqual(T("com.example.tasks.Result<T>?", ["T"]));
    const box = cls("com.example.tasks", "Box");
    expect(box.properties!.find((p) => p.name === "value")!.type).toEqual(T("T?", ["T"]));
    expect(box.constructors![0]!.params[0]!.type).toEqual(T("T?", ["T"]));
    // A raw type: no arguments.
    expect(box.methods!.find((x) => x.name === "raw")!.returns).toEqual(
      T("com.example.tasks.Result?"),
    );
    expect(mod("com.example.tasks").skipped).toEqual([]);
  });

  it("extracts Task and ListenableFuture as ordinary classes, raw methods and all", () => {
    const task = cls("com.google.android.gms.tasks", "Task");
    const future = cls("com.google.common.util.concurrent", "ListenableFuture");

    // No name makes a class awaitable: nothing marks them, or their subclasses.
    for (const c of [task, future, cls("com.example.tasks", "Lookup")])
      expect(Object.keys(c)).not.toContain("awaits");

    expect(task.methods!.map((m) => m.name)).toEqual(
      expect.arrayContaining(["addOnCompleteListener", "getResult", "isSuccessful"]),
    );
  });

  it("records the artifact, target and extractor a package's declarations come from", () => {
    expect(mod("com.example.widgets").provenance).toEqual({
      artifact: "jar:fixture.jar",
      kind: "jar",
      target: "android",
      contentHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      extractor: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
  });

  it("makes annotation types holding constants enums, as Play services' Priority", () => {
    expect(mod("com.example.widgets").types.find((t) => t.name === "Mode")).toEqual({
      kind: "enum",
      name: "Mode",
      native: "com/example/widgets/Mode",
      symbol: "jvm:com/example/widgets/Mode",
      cases: [
        { name: "FAST", native: "FAST", value: 1 },
        { name: "SLOW", native: "SLOW", value: 2 },
      ],
    });
  });

  it("types @IntDef and @StringDef parameters and results as the constants they allow", () => {
    const gauge = cls("com.example.widgets", "Gauge");
    const m = (name: string) => gauge.methods!.find((x) => x.name === name)!;
    const modes = ["com.example.widgets.Gauge.MODE_FAST", "com.example.widgets.Gauge.MODE_SLOW"];
    expect(m("setMode").params[0]!.oneOf).toEqual(modes);
    expect(m("getMode").returnsOneOf).toEqual(modes);
    expect(gauge.properties!.find((p) => p.name === "mode")!.oneOf).toEqual(modes);
    expect(m("setUnit").params[0]!.oneOf).toEqual([
      "com.example.widgets.Gauge.UNIT_KM",
      "com.example.widgets.Gauge.UNIT_MI",
    ]);
    // Flags combine with |: any number. A constant that does not exist: the group is dropped.
    expect(m("setFlags").params[0]).not.toHaveProperty("oneOf");
    expect(m("setSpeed").params[1]).not.toHaveProperty("oneOf");
  });

  it("leaves out an Object result a subclass narrows to a value, and says so", () => {
    const names = (name: string) => cls("com.example.widgets", name).methods!.map((x) => x.name);

    // TypeScript cannot narrow the Java object Object stands for to an array or a string.
    expect(names("Store")).toEqual(["next"]);
    expect(mod("com.example.widgets").skipped).toEqual(
      expect.arrayContaining([
        "com.example.widgets.Store.contents()Ljava/lang/Object;: returns Object, which com.example.widgets.ByteStore narrows to a value",
        "com.example.widgets.Store.label()Ljava/lang/Object;: returns Object, which com.example.widgets.ByteStore narrows to a value",
      ]),
    );

    // The overrides stay, and so does an Object result narrowed to a class.
    expect(names("ByteStore")).toEqual(["contents", "label"]);
    expect(names("StoreChain")).toEqual(["next"]);
  });

  it("keeps an abstract class's constructors, and protected ones as protected, for subclasses", () => {
    expect(cls("com.example.decl", "Callback").constructors?.map((c) => c.params.length)).toEqual([
      0,
    ]);
    expect(
      cls("com.example.decl", "Hook").constructors?.map((c) => [c.params.length, c.protected]),
    ).toEqual([
      [0, true],
      [1, true],
    ]);
    // Public constructors are not marked.
    expect(cls("com.example.decl", "Screen").constructors?.[0]?.protected).toBeUndefined();
  });

  it("keeps a non-null result non-null in an override and a hiding static, as callers of the base rely on", () => {
    const frame = cls("com.example.decl", "Frame");
    const result = (name: string) => frame.methods!.find((x) => x.name === name)!.returns;

    // @Nullable on the override: the base's contract (@NonNull) is what callers were promised.
    expect(result("getScreen")).toEqual(T("com.example.decl.Screen"));
    expect(result("obtain")).toEqual(T("com.example.decl.Frame"));
  });

  it("reads the result contract of a method another package declares", () => {
    const own = extractAndroid({
      jars: [jar],
      apiVersions: path.join(fixtures, "api-versions.xml"),
      annotations,
      packages: ["com.example.decl"],
    });
    const dial = own[0]!.types.find((x) => x.name === "Dial");
    if (dial?.kind !== "class") throw new Error("no Dial");

    expect(dial.methods!.find((x) => x.name === "getMode")!.returnsOneOf).toEqual([
      "com.example.widgets.Gauge.MODE_FAST",
      "com.example.widgets.Gauge.MODE_SLOW",
    ]);
  });

  it("leaves out a getter's property named like a method, and a method named like an inherited property", () => {
    const frame = cls("com.example.decl", "Frame");

    // Host's layout(int, int): the property getLayout() would give takes its name.
    expect(frame.properties?.map((p) => p.name) ?? []).not.toContain("layout");
    expect(frame.methods!.map((m) => m.name)).toContain("getLayout");

    // Host's property empty (isEmpty()): Frame's method empty() would take its name.
    expect(cls("com.example.decl", "Host").properties?.map((p) => p.name)).toContain("empty");
    expect(frame.methods!.map((m) => m.name)).not.toContain("empty");
    expect(mod("com.example.decl").skipped).toEqual(
      expect.arrayContaining([
        "com.example.decl.Frame.empty()Z: named like the property empty of com.example.decl.Host (isEmpty())",
      ]),
    );

    // Host declares no property hasOverlappingRendering: its method of that name takes it.
    expect(frame.methods!.map((m) => m.name)).toContain("hasOverlappingRendering");

    // getLayout() itself stays: coverage would count it both callable and left out.
    expect(mod("com.example.decl").skipped!.filter((s) => s.includes("getLayout"))).toEqual([]);
  });

  it("leaves out an Object result an override narrows to an interface or a type variable", () => {
    const names = (name: string) => cls("com.example.decl", name).methods!.map((x) => x.name);

    // TypeScript cannot relate an interface or a type variable to the Java object Object stands for.
    expect(names("Source")).toEqual(["label"]);
    expect(mod("com.example.decl").skipped).toEqual(
      expect.arrayContaining([
        "com.example.decl.Source.child()Ljava/lang/Object;: returns Object, which com.example.decl.Rows narrows to an interface",
        "com.example.decl.Source.item(I)Ljava/lang/Object;: returns Object, which com.example.decl.Rows narrows to a type variable",
      ]),
    );

    // The overrides stay; so does an Object result narrowed to a class (classes extend Object).
    expect(names("Rows")).toEqual(["child", "item", "label"]);
  });

  it("leaves out protected constructors beside public ones: TypeScript's overloads share one access", () => {
    expect(
      cls("com.example.decl", "Plate").constructors?.map((c) => [c.params.length, c.protected]),
    ).toEqual([[0, undefined]]);
    expect(mod("com.example.decl").skipped).toContain(
      "com.example.decl.Plate.<init>(I)V: protected, beside public constructors (TypeScript's overloads share one access)",
    );
  });

  it("leaves out an override narrowing a string result to a Java object: the string one is called", () => {
    expect(cls("com.example.decl", "Field").methods?.map((m) => m.name) ?? []).not.toContain(
      "getText",
    );
    expect(mod("com.example.decl").skipped).toContain(
      "com.example.decl.Field.getText()Lcom/example/decl/Editableish;: narrows the string com.example.decl.Marks.getText returns to a Java object: that one is called",
    );
  });

  it("leaves out an override whose result is a bounded type variable, a bound the declarations lack", () => {
    expect(cls("com.example.decl", "PrimitiveSplitter").methods!.map((m) => m.name)).toEqual([
      "size",
    ]);
    expect(mod("com.example.decl").skipped).toContain(
      "com.example.decl.PrimitiveSplitter.split()Lcom/example/decl/PrimitiveSplitter;: returns a type variable bounded by what com.example.decl.Splitter.split returns, a bound the declarations do not carry",
    );
  });

  it("keeps the result contract of the method an unannotated override overrides", () => {
    const fast = cls("com.example.widgets", "FastGauge");
    const m = (name: string) => fast.methods!.find((x) => x.name === name)!;

    expect(m("label").returns).toEqual({ k: "string", nullable: false });
    expect(m("getMode").returnsOneOf).toEqual([
      "com.example.widgets.Gauge.MODE_FAST",
      "com.example.widgets.Gauge.MODE_SLOW",
    ]);
  });
});

/** An AAR of one Java source file, as Gradle downloads libraries: classes.jar inside a zip. */
function aarOf(name: string, pkg: string, source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-aar-"));
  const src = path.join(dir, "src", ...pkg.split("."));
  const file = path.join(src, `${/class (\w+)/.exec(source)![1]}.java`);
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(file, source);

  const classes = path.join(dir, "classes");
  const cc = spawnSync("javac", ["--release", "11", "-d", classes, file], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error(cc.stderr);

  const aar = path.join(dir, "aar");
  fs.mkdirSync(aar);
  spawnSync("jar", ["cf", path.join(aar, "classes.jar"), "-C", classes, "."]);
  const out = path.join(dir, name);
  spawnSync("jar", ["cfM", out, "-C", aar, "."]);

  return out;
}

describe.skipIf(!javac)("Android extractor, artifacts", () => {
  it("tells declarations of distinct artifacts apart, whatever their names", () => {
    const jar = fixtureJar();
    const aar = aarOf(
      "other.aar",
      "com.example.other",
      "package com.example.other;\npublic class Widget {\n  public Widget() {}\n}\n",
    );
    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-copy-")), "copy.jar");
    fs.copyFileSync(jar, copy);

    const [widgets, other] = extractAndroid({
      jars: [jar, aar],
      packages: ["com.example.widgets", "com.example.other"],
    });
    const [again] = extractAndroid({ jars: [copy], packages: ["com.example.widgets"] });
    const identity = (m: typeof widgets, name: string) =>
      `${m!.provenance!.artifact} ${m!.types.find((t) => t.name === name)!.symbol}`;

    // One Lucent name, two artifacts and two symbols.
    expect(identity(widgets, "Widget")).toBe("jar:fixture.jar jvm:com/example/widgets/Widget");
    expect(identity(other, "Widget")).toBe("aar:other.aar jvm:com/example/other/Widget");
    expect(other!.provenance).toMatchObject({ kind: "aar", target: "android" });

    // One symbol in two artifacts: the pair still tells them apart; the same bytes, the same hash.
    expect(identity(again, "Widget")).toBe("jar:copy.jar jvm:com/example/widgets/Widget");
    expect(again!.provenance!.contentHash).toBe(widgets!.provenance!.contentHash);
    expect(other!.provenance!.contentHash).not.toBe(widgets!.provenance!.contentHash);
  });
});

describe.skipIf(!javac)("Android extractor, AARs", () => {
  it("reads an AAR's own annotations.zip", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-aar-"));
    const src = path.join(dir, "src/com/example/aar");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, "Dial.java"),
      `package com.example.aar;
public class Dial {
  public static final int SIZE_S = 1;
  public static final int SIZE_L = 2;
  public Dial() {}
  public void setSize(int size) {}
}
`,
    );
    const classes = path.join(dir, "classes");
    const cc = spawnSync("javac", ["--release", "11", "-d", classes, path.join(src, "Dial.java")], {
      encoding: "utf8",
    });
    if (cc.status !== 0) throw new Error(cc.stderr);
    const aar = path.join(dir, "aar");
    fs.mkdirSync(path.join(dir, "ann/com/example/aar"), { recursive: true });
    fs.mkdirSync(aar);
    fs.writeFileSync(
      path.join(dir, "ann/com/example/aar/annotations.xml"),
      `<root>
  <item name="com.example.aar.Dial void setSize(int) 0">
    <annotation name="androidx.annotation.IntDef">
      <val name="value" val="{com.example.aar.Dial.SIZE_S, com.example.aar.Dial.SIZE_L}" />
    </annotation>
  </item>
</root>
`,
    );
    spawnSync("jar", ["cf", path.join(aar, "classes.jar"), "-C", classes, "."]);
    spawnSync("jar", ["cfM", path.join(aar, "annotations.zip"), "-C", path.join(dir, "ann"), "."]);
    const file = path.join(dir, "dial.aar");
    spawnSync("jar", ["cfM", file, "-C", aar, "."]);
    const [m] = extractAndroid({ jars: [file], packages: ["com.example.aar"] });
    const dial = m!.types.find((t) => t.name === "Dial");
    if (dial?.kind !== "class") throw new Error("no Dial");
    expect(dial.methods!.find((x) => x.name === "setSize")!.params[0]!.oneOf).toEqual([
      "com.example.aar.Dial.SIZE_S",
      "com.example.aar.Dial.SIZE_L",
    ]);
  });
});
