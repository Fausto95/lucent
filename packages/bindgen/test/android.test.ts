import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { extractAndroid } from "../src/android.ts";
import { parseSchemaType } from "../src/schema.ts";

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
  const modules = javac
    ? extractAndroid({
        jars: [fixtureJar()],
        apiVersions: path.join(fixtures, "api-versions.xml"),
        annotations: annotationsZip(),
        packages: ["com.example.widgets", "com.example.base"],
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
    expect(cls("com.example.widgets", "Widget_Listener").constructors ?? []).toEqual([]);
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

  it("keeps public constructors with exact descriptors", () => {
    expect(widget().constructors).toEqual([
      { params: [], descriptor: "()V" },
      { params: [{ name: "arg0", type: T("string") }], descriptor: "(Ljava/lang/String;)V" },
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
      { name: "TIMEOUT", static: true, readonly: true, type: T("long"), value: 30 },
    ]);
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
});
