import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractIos } from "../src/ios.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/objc");
const xcode = process.platform === "darwin" && spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).status === 0;

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
    expect(widget()).toMatchObject({ native: "WDGWidget", mainActor: true, implements: ["Widgets.WDGShape"] });
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
    expect(type("WDGEdges")).toMatchObject({ kind: "enum", cases: [{ name: "top", value: 1 }, { name: "bottom", value: 2 }] });
  });

  it("maps initializers, factories and class properties to their selectors", () => {
    expect(widget().constructors).toEqual([
      { params: [], selector: "init" },
      { params: [{ name: "style", type: "Widgets.WDGStyle" }], selector: "initWithStyle:" },
    ]);
    expect(method("named")[0]).toMatchObject({ static: true, selector: "widgetNamed:", params: [{ name: "name", type: "string" }], returns: "Widgets.WDGWidget" });
    const props = Object.fromEntries(widget().properties!.map((p) => [p.name, p]));
    expect(props.shared).toMatchObject({ static: true, readonly: true, selector: "sharedWidget", type: "Widgets.WDGWidget" });
    expect(props.name).toMatchObject({ type: "string", setter: "setName:" });
    expect(props.name!.readonly).toBeFalsy();
    expect(props.label).toMatchObject({ type: "string?", setter: "setLabel:" });
    expect(props.isEnabled).toMatchObject({ readonly: true, selector: "isEnabled", type: "bool" });
    expect(props.edges).toMatchObject({ type: "Widgets.WDGEdges" });
    expect(props.size).toMatchObject({ type: "uint64" });
  });

  it("types parameters and results: nullability, collections, data, dates, id", () => {
    expect(method("touch")[0]).toMatchObject({ selector: "touch:other:", params: [{ type: "Widgets.WDGShape" }, { type: "Widgets.WDGWidget?" }], returns: "void" });
    expect(method("tags")[0]!.returns).toBe("string[]");
    expect(method("data")[0]).toMatchObject({ selector: "dataForKey:", returns: "NSData?" });
    expect(method("attributes")[0]!.returns).toBe("Record<id>");
    expect(method("setObject")[0]!.params.map((p) => p.type)).toEqual(["id", "string"]);
    expect(method("modified")[0]!.returns).toBe("NSDate?");
  });

  it("turns NSError** into throws", () => {
    // Swift's view: the BOOL result becomes the error signal.
    expect(method("save")[0]).toMatchObject({ selector: "saveToPath:error:", throws: true, params: [{ name: "path", type: "string" }], returns: "void" });
  });

  it("keeps NSError** out-parameters where Swift does (NS_SWIFT_NOTHROW)", () => {
    expect(method("canFrob")[0]).toMatchObject({ selector: "canFrob:error:", params: [{ name: "level", type: "NSInteger" }, { name: "error", type: "Out<error>?" }], returns: "bool" });
    expect(method("canFrob")[0]).not.toHaveProperty("throws");
  });

  it("appends labels to overloads that collide once labels are dropped", () => {
    expect(method("impact").map((m) => m.selector)).toEqual(["impact", "impactWithIntensity:"]);
    expect(method("resize").map((m) => m.selector)).toEqual(["resizeToWidth:"]);
    expect(method("resizeHeight").map((m) => m.selector)).toEqual(["resizeToHeight:"]);
  });

  it("records availability, C functions and constants, and what it skips", () => {
    expect(method("modern")[0]!.since).toBe("16.0");
    expect(mod().functions).toEqual(expect.arrayContaining([{ name: "WDGDistance", params: [{ name: "a", type: "Widgets.WDGWidget" }, { name: "b", type: "Widgets.WDGWidget" }], returns: "double" }]));
    expect(mod().constants).toEqual(expect.arrayContaining([{ name: "WDGVersionString", type: "string" }]));
    expect(mod().skipped!.some((s) => s.startsWith("WDGWidget.frame(_:): CGRect"))).toBe(true);
  });

  it("types blocks as functions: whether they escape, and the thread they run on", () => {
    const loader = type("WDGLoader");
    if (loader.kind !== "class") throw new Error("not a class");
    const on = (name: string) => loader.methods!.find((m) => m.name === name)!;
    // @Sendable, on a class that is not main-actor: any thread.
    expect(on("observe")).toMatchObject({ selector: "observeWithBlock:", params: [{ name: "block", type: "@escaping (string, NSInteger) => void" }], returns: "void" });
    expect(on("onDone")).toMatchObject({ selector: "onDone:", params: [{ name: "done", type: "@escaping () => void" }] });
    // Not @Sendable, on a main-actor class: the main thread. Called during
    // the call (no @escaping), or later; an optional block always escapes.
    expect(method("countWhere")[0]).toMatchObject({ selector: "countWhere:", params: [{ name: "predicate", type: "@main (string) => bool" }], returns: "NSInteger" });
    expect(method("animate")[0]).toMatchObject({ selector: "animate:completion:", params: [{ name: "changes", type: "@escaping @main () => void" }, { name: "completion", type: "(@main (bool) => void)?" }] });
  });

  it("turns completion handlers into promises where Swift imports them as async", () => {
    const loader = type("WDGLoader");
    if (loader.kind !== "class") throw new Error("not a class");
    const on = (name: string) => loader.methods!.find((m) => m.name === name)!;
    expect(method("fetch")[0]).toMatchObject({ selector: "fetchWithCompletion:", params: [{ name: "completion", type: "@escaping @main (bool) => void" }], async: { returns: "bool" } });
    expect(on("load")).toMatchObject({ selector: "loadWithReply:", params: [{ name: "reply", type: "@escaping (NSData?, error?) => void" }], async: { returns: "NSData", throws: true } });
    expect(method("animate")[0]).toMatchObject({ async: { returns: "bool" } });
    // Swift names the async form itself: get… drops its prefix.
    expect(on("getItemsWithCompletionHandler")).toMatchObject({ selector: "getItemsWithCompletionHandler:", async: { returns: "string[]", name: "items" } });
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
      { name: "loader_didLoad", selector: "loader:didLoadData:", params: [{ name: "loader", type: "Widgets.WDGLoader" }, { name: "data", type: "NSData" }], returns: "void" },
      { name: "loader_didFailWithError", selector: "loader:didFailWithError:", params: [{ name: "loader", type: "Widgets.WDGLoader" }, { name: "error", type: "error" }], returns: "void", optional: true },
      { name: "loaderShouldRetry", selector: "loaderShouldRetry:", params: [{ name: "loader", type: "Widgets.WDGLoader" }], returns: "bool", optional: true },
    ]);
    expect(d.methods![0]).not.toHaveProperty("optional");
    expect(method("area")).toHaveLength(1);
  });

  it("marks weak properties, which do not keep their value alive", () => {
    const loader = type("WDGLoader");
    if (loader.kind !== "class") throw new Error("not a class");
    expect(loader.properties!.find((p) => p.name === "delegate")).toMatchObject({ type: "Widgets.WDGLoaderDelegate?", setter: "setDelegate:", weak: true });
  });

  it("reads C structs of numbers and structs, by value", () => {
    expect(type("WDGPoint")).toEqual({ kind: "struct", name: "WDGPoint", native: "WDGPoint", fields: [{ name: "x", type: "double" }, { name: "y", type: "double" }] });
    expect(type("WDGCircle")).toEqual({ kind: "struct", name: "WDGCircle", native: "WDGCircle", fields: [{ name: "center", type: "Widgets.WDGPoint" }, { name: "radius", type: "double" }] });
    expect(method("origin")[0]).toMatchObject({ selector: "origin", returns: "Widgets.WDGPoint" });
    expect(widget().properties!.find((p) => p.name === "circle")).toMatchObject({ type: "Widgets.WDGCircle", setter: "setCircle:" });
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
    expect(mod().functions!.find((f) => f.name === "WDGWatch")).toEqual({ name: "WDGWatch", params: [{ name: "handler", type: "@escaping (Widgets.wdg_state_t) => void" }], returns: "void" });
  });

  it("reads typed string keys (NS_TYPED_ENUM) as string constants of their C globals", () => {
    expect(type("WDGKey")).toMatchObject({ kind: "class", properties: [{ name: "name", static: true, readonly: true, type: "string", global: "WDGKeyName" }] });
  });

  it("bridges CoreFoundation types, and out-pointers of C functions", () => {
    expect(mod().constants).toEqual(expect.arrayContaining([{ name: "WDGKeyClass", type: "CFString" }]));
    const fn = (name: string) => mod().functions!.find((f) => f.name === name);
    expect(fn("WDGItemCopy")).toEqual({ name: "WDGItemCopy", params: [{ name: "query", type: "CFDictionary" }, { name: "result", type: "Out<CFTypeRef>?" }], returns: "int32" });
    expect(fn("WDGCopyData")).toEqual({ name: "WDGCopyData", params: [{ name: "name", type: "CFString" }], returns: "CFData?" });
  });
});
