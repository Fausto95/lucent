import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { extractIos } from "../src/ios.ts";
import { parseSchemaType } from "../src/schema.ts";

/** A schema type from its written form (`string?`, `Widgets.WDGWidget`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/objc");
const xcode =
  process.platform === "darwin" &&
  spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).status === 0;

describe.skipIf(!xcode)("iOS extractor", () => {
  const modules = xcode ? extractIos({ modules: ["Widgets"], includePaths: [fixtures] }) : [];
  const mod = () => modules.find((m) => m.module === "Widgets")!;
  const type = (name: string) => {
    const t = mod().types.find((x) => x.name === name);
    if (!t) throw new Error(`no type ${name}`);
    return t;
  };
  const widget = () => {
    const t = type("WDGWidget");
    if (t.kind !== "class") throw new Error("not a class");
    return t;
  };
  const method = (name: string) => widget().methods!.filter((m) => m.name === name);

  it("reads Objective-C classes and protocols with Swift names and the main-actor rule", () => {
    expect(mod().platform).toBe("ios");
    expect(widget()).toMatchObject({
      native: "WDGWidget",
      mainActor: true,
      implements: ["Widgets.WDGShape"],
    });
    expect(type("WDGShape")).toMatchObject({ kind: "class", native: "WDGShape", interface: true });
  });

  it("gives enums and options their values, implicit ones counted from the last explicit value", () => {
    expect(type("WDGStyle")).toEqual({
      kind: "enum",
      name: "WDGStyle",
      native: "WDGStyle",
      cases: [
        { name: "light", native: "WDGStyleLight", value: 0 },
        { name: "medium", native: "WDGStyleMedium", value: 1 },
        { name: "heavy", native: "WDGStyleHeavy", value: 10 },
        { name: "rigid", native: "WDGStyleRigid", value: 11 },
      ],
    });
    expect(type("WDGEdges")).toMatchObject({
      kind: "enum",
      cases: [
        { name: "top", value: 1 },
        { name: "bottom", value: 2 },
      ],
    });
  });

  it("maps initializers, factories and class properties to their selectors", () => {
    expect(widget().constructors).toEqual([
      { params: [], selector: "init" },
      { params: [{ name: "style", type: T("Widgets.WDGStyle") }], selector: "initWithStyle:" },
    ]);
    expect(method("named")[0]).toMatchObject({
      static: true,
      selector: "widgetNamed:",
      params: [{ name: "name", type: T("string") }],
      returns: T("Widgets.WDGWidget"),
    });
    const props = Object.fromEntries(widget().properties!.map((p) => [p.name, p]));
    expect(props.shared).toMatchObject({
      static: true,
      readonly: true,
      selector: "sharedWidget",
      type: T("Widgets.WDGWidget"),
    });
    expect(props.name).toMatchObject({ type: T("string"), setter: "setName:" });
    expect(props.name!.readonly).toBeFalsy();
    expect(props.label).toMatchObject({ type: T("string?"), setter: "setLabel:" });
    expect(props.isEnabled).toMatchObject({
      readonly: true,
      selector: "isEnabled",
      type: T("bool"),
    });
    expect(props.edges).toMatchObject({ type: T("Widgets.WDGEdges") });
    expect(props.size).toMatchObject({ type: T("uint64") });
  });

  it("types parameters and results: nullability, collections, data, dates, id", () => {
    expect(method("touch")[0]).toMatchObject({
      selector: "touch:other:",
      params: [{ type: T("Widgets.WDGShape") }, { type: T("Widgets.WDGWidget?") }],
      returns: T("void"),
    });
    expect(method("tags")[0]!.returns).toEqual(T("string[]"));
    expect(method("data")[0]).toMatchObject({ selector: "dataForKey:", returns: T("NSData?") });
    expect(method("attributes")[0]!.returns).toEqual(T("Record<id>"));
    expect(method("setObject")[0]!.params.map((p) => p.type)).toEqual(
      ["id", "string"].map((x) => T(x)),
    );
    expect(method("modified")[0]!.returns).toEqual(T("NSDate?"));
  });

  it("turns NSError** into throws", () => {
    // Swift's view: the BOOL result becomes the error signal.
    expect(method("save")[0]).toMatchObject({
      selector: "saveToPath:error:",
      throws: true,
      params: [{ name: "path", type: T("string") }],
      returns: T("void"),
    });
  });

  it("keeps NSError** out-parameters where Swift does (NS_SWIFT_NOTHROW)", () => {
    expect(method("canFrob")[0]).toMatchObject({
      selector: "canFrob:error:",
      params: [
        { name: "level", type: T("NSInteger") },
        { name: "error", type: T("Out<error>?") },
      ],
      returns: T("bool"),
    });
    expect(method("canFrob")[0]).not.toHaveProperty("throws");
  });

  it("appends labels to overloads that collide once labels are dropped", () => {
    expect(method("impact").map((m) => m.selector)).toEqual(["impact", "impactWithIntensity:"]);
    expect(method("resize").map((m) => m.selector)).toEqual(["resizeToWidth:"]);
    expect(method("resizeHeight").map((m) => m.selector)).toEqual(["resizeToHeight:"]);
  });

  it("keeps the labels of methods named as a property of their class, which keeps the name", () => {
    expect(method("label")).toEqual([]);
    expect(method("labelForWidth").map((m) => m.selector)).toEqual(["labelForWidth:"]);
    expect(widget().properties?.find((p) => p.name === "label")?.type).toEqual(T("string?"));
  });

  it("records availability, C functions and constants, and what it skips", () => {
    expect(method("modern")[0]!.since).toBe("16.0");
    expect(mod().functions).toEqual(
      expect.arrayContaining([
        {
          name: "WDGDistance",
          params: [
            { name: "a", type: T("Widgets.WDGWidget") },
            { name: "b", type: T("Widgets.WDGWidget") },
          ],
          returns: T("double"),
        },
      ]),
    );
    expect(mod().constants).toEqual(
      expect.arrayContaining([{ name: "WDGVersionString", type: T("string") }]),
    );
    expect(mod().skipped!.some((s) => s.startsWith("WDGWidget.frame(_:): CGRect"))).toBe(true);
  });

  it("types blocks as functions: whether they escape, and the thread they run on", () => {
    const loader = type("WDGLoader");
    if (loader.kind !== "class") throw new Error("not a class");
    const on = (name: string) => loader.methods!.find((m) => m.name === name)!;
    // @Sendable, on a class that is not main-actor: any thread.
    expect(on("observe")).toMatchObject({
      selector: "observeWithBlock:",
      params: [{ name: "block", type: T("@escaping (string, NSInteger) => void") }],
      returns: T("void"),
    });
    expect(on("onDone")).toMatchObject({
      selector: "onDone:",
      params: [{ name: "done", type: T("@escaping () => void") }],
    });
    // Not @Sendable, on a main-actor class: the main thread. Called during
    // the call (no @escaping), or later; an optional block always escapes.
    expect(method("countWhere")[0]).toMatchObject({
      selector: "countWhere:",
      params: [{ name: "predicate", type: T("@main (string) => bool") }],
      returns: T("NSInteger"),
    });
    expect(method("animate")[0]).toMatchObject({
      selector: "animate:completion:",
      params: [
        { name: "changes", type: T("@escaping @main () => void") },
        { name: "completion", type: T("(@main (bool) => void)?") },
      ],
    });
  });

  it("turns completion handlers into promises where Swift imports them as async", () => {
    const loader = type("WDGLoader");
    if (loader.kind !== "class") throw new Error("not a class");
    const on = (name: string) => loader.methods!.find((m) => m.name === name)!;
    expect(method("fetch")[0]).toMatchObject({
      selector: "fetchWithCompletion:",
      params: [{ name: "completion", type: T("@escaping @main (bool) => void") }],
      async: { returns: T("bool") },
    });
    expect(on("load")).toMatchObject({
      selector: "loadWithReply:",
      params: [{ name: "reply", type: T("@escaping (NSData?, error?) => void") }],
      async: { returns: T("NSData"), throws: true },
    });
    expect(method("animate")[0]).toMatchObject({ async: { returns: T("bool") } });
    // Swift names the async form itself: get… drops its prefix.
    expect(on("getItemsWithCompletionHandler")).toMatchObject({
      selector: "getItemsWithCompletionHandler:",
      async: { returns: T("string[]"), name: "items" },
    });
    expect(on("load")!.async).not.toHaveProperty("name");
    // Several results (a tuple), or NS_SWIFT_DISABLE_ASYNC: the block form only.
    expect(on("observe")).not.toHaveProperty("async");
    expect(on("onDone")).not.toHaveProperty("async");
  });

  it("names protocol requirements from their own Swift names, and marks optional ones", () => {
    const d = type("WDGLoaderDelegate");
    if (d.kind !== "class") throw new Error("not a class");
    // Swift's base name and labels, as in the selector: stable whatever else the protocol declares.
    expect(d).toMatchObject({ interface: true });
    expect(d.methods).toMatchObject([
      {
        name: "loader_didLoad",
        selector: "loader:didLoadData:",
        params: [
          { name: "loader", type: T("Widgets.WDGLoader") },
          { name: "data", type: T("NSData") },
        ],
        returns: T("void"),
      },
      {
        name: "loader_didFailWithError",
        selector: "loader:didFailWithError:",
        params: [
          { name: "loader", type: T("Widgets.WDGLoader") },
          { name: "error", type: T("error") },
        ],
        returns: T("void"),
        optional: true,
      },
      {
        name: "loaderShouldRetry",
        selector: "loaderShouldRetry:",
        params: [{ name: "loader", type: T("Widgets.WDGLoader") }],
        returns: T("bool"),
        optional: true,
      },
    ]);
    expect(d.methods![0]).not.toHaveProperty("optional");
    expect(method("area")).toHaveLength(1);
  });

  it("marks weak properties, which do not keep their value alive", () => {
    const loader = type("WDGLoader");
    if (loader.kind !== "class") throw new Error("not a class");
    expect(loader.properties!.find((p) => p.name === "delegate")).toMatchObject({
      type: T("Widgets.WDGLoaderDelegate?"),
      setter: "setDelegate:",
      weak: true,
    });
  });

  it("reads C structs of numbers and structs, by value", () => {
    expect(type("WDGPoint")).toEqual({
      kind: "struct",
      name: "WDGPoint",
      native: "WDGPoint",
      fields: [
        { name: "x", type: T("double") },
        { name: "y", type: T("double") },
      ],
    });
    expect(type("WDGCircle")).toEqual({
      kind: "struct",
      name: "WDGCircle",
      native: "WDGCircle",
      fields: [
        { name: "center", type: T("Widgets.WDGPoint") },
        { name: "radius", type: T("double") },
      ],
    });
    expect(method("origin")[0]).toMatchObject({
      selector: "origin",
      returns: T("Widgets.WDGPoint"),
    });
    expect(widget().properties!.find((p) => p.name === "circle")).toMatchObject({
      type: T("Widgets.WDGCircle"),
      setter: "setCircle:",
    });
  });

  it("reads anonymous C enums (typedef enum {…} name_t), and C functions' escaping blocks", () => {
    expect(type("wdg_state_t")).toEqual({
      kind: "enum",
      name: "wdg_state_t",
      native: "wdg_state_t",
      cases: [
        { name: "wdg_state_idle", native: "wdg_state_idle", value: 0 },
        { name: "wdg_state_busy", native: "wdg_state_busy", value: 3 },
        { name: "wdg_state_done", native: "wdg_state_done", value: 4 },
      ],
    });
    expect(mod().functions!.find((f) => f.name === "WDGWatch")).toEqual({
      name: "WDGWatch",
      params: [{ name: "handler", type: T("@escaping (Widgets.wdg_state_t) => void") }],
      returns: T("void"),
    });
  });

  it("reads typed string keys (NS_TYPED_ENUM) as string constants of their C globals", () => {
    expect(type("WDGKey")).toMatchObject({
      kind: "class",
      properties: [
        { name: "name", static: true, readonly: true, type: T("string"), global: "WDGKeyName" },
      ],
    });
  });

  it("bridges CoreFoundation types, and out-pointers of C functions", () => {
    expect(mod().constants).toEqual(
      expect.arrayContaining([{ name: "WDGKeyClass", type: T("CFString") }]),
    );
    const fn = (name: string) => mod().functions!.find((f) => f.name === name);
    expect(fn("WDGItemCopy")).toEqual({
      name: "WDGItemCopy",
      params: [
        { name: "query", type: T("CFDictionary") },
        { name: "result", type: T("Out<CFTypeRef>?") },
      ],
      returns: T("int32"),
    });
    expect(fn("WDGCopyData")).toEqual({
      name: "WDGCopyData",
      params: [{ name: "name", type: T("CFString") }],
      returns: T("CFData?"),
    });
  });
});
