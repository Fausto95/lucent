import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { buildIosSchemas, extractIos, namesOf, symbolGraph } from "../src/ios.ts";
import { canonicalSchema, parseSchemaType } from "../src/schema.ts";
import type { SymbolGraph } from "../src/symbols.ts";
import { nativeId, schemaSymbols } from "./schema-symbols.ts";
import { swiftModule } from "./swift-module.ts";
import { flagsNotFromFacts } from "./thread-flags.ts";

/** A schema type from its written form (`string?`, `Widgets.WDGWidget`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/objc");
const xcode =
  process.platform === "darwin" &&
  spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).status === 0;

/** A module's symbol graph, as the extractor reads it: the native identities to compare with. */
function graphOf(module: string, includePath: string): SymbolGraph {
  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();

  return symbolGraph(module, { modules: [module], includePaths: [includePath] }, sdk);
}

/** The USR of the graph's declaration at `path` (`["Point", "distance(to:)"]`). */
function usrAt(g: SymbolGraph, ...path: string[]): string {
  const s = g.symbols.find((x) => x.pathComponents.join("/") === path.join("/"));
  if (!s) throw new Error(`no symbol ${path.join(".")}`);

  return s.identifier.precise;
}

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
  const cls = (name: string) => {
    const t = type(name);
    if (t.kind !== "class") throw new Error(`${name} is not a class`);
    return t;
  };

  it("orders what it reads from the graph itself, whatever order the tool writes", () => {
    const g = graphOf("Widgets", fixtures);

    // Conformances are what swift-symbolgraph-extract has been seen to write in varying order.
    const conformances = g.relationships.filter((r) => r.kind === "conformsTo").toReversed();
    const reversed: SymbolGraph = {
      ...g,
      relationships: g.relationships.map((r) =>
        r.kind === "conformsTo" ? conformances.shift()! : r,
      ),
    };
    const schema = (graph: SymbolGraph) =>
      buildIosSchemas(new Map([["Widgets", graph]]), () => new Map()).map(canonicalSchema);

    expect(schema(reversed)).toEqual(schema(g));
    expect(namesOf("Widgets", reversed)).toEqual(namesOf("Widgets", g));
    expect(cls("WDGDial").implements).toEqual(["Widgets.WDGFramed", "Widgets.WDGShape"]);
  });

  it("names a method named like its superclass's property with its labels", () => {
    const caption = cls("WDGCaption");

    expect(caption.methods?.map((m) => m.name)).toEqual(["textFor"]);
  });

  it("does not declare a conformance whose requirement the class declares differently", () => {
    const panel = cls("WDGPanel");

    expect(panel.implements ?? []).not.toContain("Widgets.WDGFramed");
    expect(mod().skipped).toContainEqual(expect.stringMatching(/WDGPanel.*WDGFramed.*level/));
  });

  it("keeps a superclass's non-null property when a subclass redeclares it without a contract", () => {
    const text = cls("WDGLabel").properties!.find((p) => p.name === "text")!;

    expect(text.type).toEqual({ k: "string", nullable: false });
    expect(text.readonly).toBeUndefined();
  });

  it("lists the protocols a class adopts itself, not those its superclasses adopt", () => {
    const gauge = cls("WDGGauge");

    expect(gauge.extends).toBe("Widgets.WDGWidget");
    expect(gauge.implements).toEqual(["Widgets.WDGLoaderDelegate"]);
  });

  it("identifies declarations by their clang USRs: Objective-C ones objc:, C ones c:", () => {
    const usrs = new Set(graphOf("Widgets", fixtures).symbols.map((s) => s.identifier.precise));
    const symbols = schemaSymbols(mod());

    expect(widget().symbol).toBe("objc:c:objc(cs)WDGWidget");
    expect(method("touch")[0]!.symbol).toBe("objc:c:objc(cs)WDGWidget(im)touch:other:");
    expect(widget().properties!.find((p) => p.name === "shared")!.symbol).toBe(
      "objc:c:objc(cs)WDGWidget(cpy)sharedWidget",
    );
    expect(type("WDGShape").symbol).toBe("objc:c:objc(pl)WDGShape");
    expect(type("WDGStyle").symbol).toBe("c:c:@E@WDGStyle");
    expect(mod().functions!.find((f) => f.name === "WDGDistance")!.symbol).toBe(
      "c:c:@F@WDGDistance",
    );

    // Overloads renamed for TypeScript keep the selector they send.
    expect(method("resizeHeight")[0]!.symbol).toBe("objc:c:objc(cs)WDGWidget(im)resizeToHeight:");

    // Each is the USR of a declaration in the module's symbol graph.
    expect(symbols.length).toBeGreaterThan(50);
    expect(symbols.filter((x) => !usrs.has(nativeId(x)))).toEqual([]);
    expect(symbols.filter((x) => !/^(objc:c:objc\(|c:c:)/.test(x))).toEqual([]);
  });

  it("records @MainActor as a fact, with the attribute as evidence", () => {
    expect(widget().facts).toEqual({
      affinity: "main",
      blocking: "unknown",
      ownership: "unknown",
      evidence: [{ fact: "affinity", source: "attribute", detail: "@MainActor" }],
    });
    expect(type("WDGLoader")).not.toHaveProperty("facts");
    expect(flagsNotFromFacts(modules)).toEqual([]);
  });

  it("keeps members of generic classes and protocols on the declaration's own USR", () => {
    const box = type("WDGBox");
    const delegate = type("WDGLoaderDelegate");
    if (box.kind !== "class" || delegate.kind !== "class") throw new Error("not a class");

    expect(box.methods!.find((m) => m.name === "object")!.symbol).toBe(
      "objc:c:objc(cs)WDGBox(im)object",
    );
    expect(delegate.methods!.find((m) => m.name === "loader_didLoad")!.symbol).toBe(
      "objc:c:objc(pl)WDGLoaderDelegate(im)loader:didLoadData:",
    );
  });

  it("reads Objective-C classes and protocols with Swift names and the main-actor rule", () => {
    expect(mod().platform).toBe("ios");
    expect(mod().provenance).toMatchObject({
      artifact: "clang-module:Widgets",
      kind: "clang-module",
      target: "arm64-apple-ios15.1-simulator",
    });
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
      symbol: "c:c:@E@WDGStyle",
      cases: [
        { name: "light", native: "WDGStyleLight", value: 0 },
        { name: "medium", native: "WDGStyleMedium", value: 1 },
        { name: "heavy", native: "WDGStyleHeavy", value: 10 },
        { name: "rigid", native: "WDGStyleRigid", value: 11 },
      ],
    });
    // NS_OPTIONS: an option set, whose empty value 0 no case names.
    expect(type("WDGEdges")).toMatchObject({
      kind: "enum",
      options: true,
      cases: [
        { name: "top", value: 1 },
        { name: "bottom", value: 2 },
      ],
    });
    expect(type("WDGStyle")).not.toHaveProperty("options");
  });

  it("maps initializers, factory initializers, factories and class properties to their selectors", () => {
    expect(widget().constructors).toEqual([
      { params: [], selector: "init", symbol: "objc:c:objc(cs)WDGWidget(im)init" },
      {
        params: [{ name: "style", type: T("Widgets.WDGStyle") }],
        selector: "initWithStyle:",
        symbol: "objc:c:objc(cs)WDGWidget(im)initWithStyle:",
      },
      // A class method Swift imports as an initializer: called on the class.
      {
        params: [{ name: "label", type: T("string") }],
        selector: "widgetWithLabel:",
        factory: true,
        symbol: "objc:c:objc(cs)WDGWidget(cm)widgetWithLabel:",
      },
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

  it("gives lightweight generics their type parameters, and references their arguments", () => {
    const box = type("WDGBox");
    if (box.kind !== "class") throw new Error("not a class");
    expect(box.typeParams).toEqual(["ObjectType"]);
    const m = (name: string) => box.methods!.find((x) => x.name === name)!;
    expect(m("object").returns).toEqual(T("ObjectType?", ["ObjectType"]));
    expect(m("setObject").params[0]!.type).toEqual(T("ObjectType", ["ObjectType"]));
    expect(box.properties!.find((p) => p.name === "first")!.type).toEqual(
      T("ObjectType", ["ObjectType"]),
    );
    const boxes = type("WDGBoxes");
    if (boxes.kind !== "class") throw new Error("not a class");
    const names = boxes.methods!.find((x) => x.name === "names")!;
    expect(names.returns).toEqual(T("Widgets.WDGBox<string>"));
    const fill = boxes.methods!.find((x) => x.name === "fill")!;
    expect(fill.params[0]!.type).toEqual(T("Widgets.WDGBox<Widgets.WDGWidget>"));
  });

  it("reads pointers to numbers, enums, structs and objects as out-parameters", () => {
    const meter = type("WDGMeter");
    if (meter.kind !== "class") throw new Error("not a class");
    const params = (selector: string) =>
      meter.methods!.find((m) => m.selector === selector)!.params.map((p) => p.type);
    expect(params("getLevel:peak:")).toEqual([T("Out<double>"), T("Out<double>?")]);
    expect(params("getStyle:")).toEqual([T("Out<Widgets.WDGStyle>")]);
    expect(params("adjustPoint:")).toEqual([T("Out<Widgets.WDGPoint>")]);
    expect(params("readSince:label:")).toEqual([T("Out<NSDate>?"), T("Out<string>?")]);
    // BOOL * is Swift's UnsafeMutablePointer<ObjCBool>, in blocks' parameters too.
    expect(params("getOn:")).toEqual([T("Out<bool>")]);
    expect(params("enumerateLevels:")).toEqual([T("(double, Out<bool>) => void")]);
  });

  it("keeps NSObject's init for a class whose only initializer a protocol synthesizes", () => {
    const record = type("WDGRecord");
    if (record.kind !== "class") throw new Error("not a class");
    // Inherited, or declared here where NSObject is not extracted (as in this fixture).
    const inits = (record.constructors ?? []).map((c) => c.selector);
    expect(record.inheritsInit || inits.includes("init")).toBe(true);
    expect(inits.every((s) => s === "init")).toBe(true);
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
          symbol: "c:c:@F@WDGDistance",
        },
      ]),
    );
    expect(mod().constants).toEqual(
      expect.arrayContaining([
        { name: "WDGVersionString", type: T("string"), symbol: "c:c:@WDGVersionString" },
      ]),
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
      symbol: "c:c:@SA@WDGPoint",
      fields: [
        { name: "x", type: T("double") },
        { name: "y", type: T("double") },
      ],
    });
    expect(type("WDGCircle")).toEqual({
      kind: "struct",
      name: "WDGCircle",
      native: "WDGCircle",
      symbol: "c:c:@SA@WDGCircle",
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
      symbol: "c:c:@EA@wdg_state_t",
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
      symbol: "c:c:@F@WDGWatch",
    });
  });

  it("reads typed string keys (NS_TYPED_ENUM) as string constants of their C globals", () => {
    expect(type("WDGKey")).toMatchObject({
      kind: "class",
      symbol: "c:c:Widgets.h@T@WDGKey",
      properties: [
        {
          name: "name",
          static: true,
          readonly: true,
          type: T("string"),
          global: "WDGKeyName",
          symbol: "c:c:@WDGKeyName",
        },
      ],
    });
  });

  it("bridges CoreFoundation types, and out-pointers of C functions", () => {
    expect(mod().constants).toEqual(
      expect.arrayContaining([
        { name: "WDGKeyClass", type: T("CFString"), symbol: "c:c:@WDGKeyClass" },
      ]),
    );
    const fn = (name: string) => mod().functions!.find((f) => f.name === name);
    expect(fn("WDGItemCopy")).toEqual({
      name: "WDGItemCopy",
      params: [
        { name: "query", type: T("CFDictionary") },
        { name: "result", type: T("Out<CFTypeRef>?") },
      ],
      returns: T("int32"),
      symbol: "c:c:@F@WDGItemCopy",
    });
    expect(fn("WDGCopyData")).toEqual({
      name: "WDGCopyData",
      params: [{ name: "name", type: T("CFString") }],
      returns: T("CFData?"),
      symbol: "c:c:@F@WDGCopyData",
    });
  });
});

describe.skipIf(!xcode)("iOS extractor, Swift modules", () => {
  const dir = xcode ? swiftModule("Shapes") : "";
  const modules = xcode ? extractIos({ modules: ["Shapes"], includePaths: [dir] }) : [];
  const graph = xcode ? graphOf("Shapes", dir) : { symbols: [], relationships: [] };
  const mod = () => modules.find((m) => m.module === "Shapes")!;
  /** The symbol of the graph's declaration at `path`. */
  const at = (...path: string[]) => `swift:${usrAt(graph, ...path)}`;

  const swiftType = (name: string) => {
    const t = mod().types.find((x) => x.name === name);
    if (!t) throw new Error(`no type ${name}`);
    return t;
  };
  const S = (s: string, tps: string[] = []) => parseSchemaType(s, "Shapes", tps);

  it("records the Swift module as the artifact its declarations come from", () => {
    expect(mod().provenance).toMatchObject({
      artifact: "swift-module:Shapes",
      kind: "swift-module",
    });
  });

  it("identifies Swift declarations by their USRs, as swift: symbols", () => {
    const usrs = new Set(graph.symbols.map((s) => s.identifier.precise));
    const symbols = schemaSymbols(mod());

    expect(symbols.length).toBeGreaterThan(30);
    expect(symbols.filter((x) => !x.startsWith("swift:s:"))).toEqual([]);
    expect(symbols.filter((x) => !usrs.has(nativeId(x)))).toEqual([]);
  });

  it("lists a property once, its own declaration over the ones protocol extensions give", () => {
    const badge = swiftType("Badge");
    if (badge.kind !== "class") throw new Error("Badge is not a class");

    const kinds = badge.properties!.filter((p) => p.name === "kind" && p.static);

    expect(kinds).toHaveLength(1);
    expect(kinds[0]!.symbol).not.toContain("SYNTHESIZED");
  });

  it("keeps the declaring symbol of generic and inherited members", () => {
    const box = swiftType("Box");
    const summer = swiftType("Summer");
    if (box.kind !== "class" || summer.kind !== "class") throw new Error("not a class");

    expect(box.properties!.find((p) => p.name === "value")!.symbol).toBe(at("Box", "value"));

    // What Accumulator's extension gives Summer is the extension's member, not a copy of it.
    const total = summer.methods!.find((m) => m.name === "total")!;
    expect(total.symbol).toBe(at("Accumulator", "total(of:)"));
    expect(total.symbol).not.toContain("SYNTHESIZED");
  });

  it("reads Swift structs and classes with their members, marked for shims", () => {
    expect(swiftType("Point")).toEqual({
      kind: "class",
      name: "Point",
      native: "Shapes.Point",
      symbol: at("Point"),
      swift: { kind: "struct" },
      constructors: [
        {
          params: [
            { name: "x", type: S("double") },
            { name: "y", type: S("double") },
          ],
          swift: { name: "init(x:y:)" },
          symbol: at("Point", "init(x:y:)"),
        },
      ],
      methods: [
        {
          name: "distance",
          params: [{ name: "other", type: S("Point") }],
          returns: S("double"),
          swift: { name: "distance(to:)" },
          symbol: at("Point", "distance(to:)"),
        },
      ],
      properties: [
        { name: "x", type: S("double"), swift: { name: "x" }, symbol: at("Point", "x") },
        { name: "y", type: S("double"), swift: { name: "y" }, symbol: at("Point", "y") },
        {
          name: "origin",
          type: S("Point"),
          static: true,
          readonly: true,
          swift: { name: "origin" },
          symbol: at("Point", "origin"),
        },
      ],
    });
    expect(swiftType("Canvas")).toMatchObject({
      native: "Shapes.Canvas",
      swift: { kind: "class" },
      constructors: [
        { params: [], swift: { name: "init()" } },
        // A sequence whose element a constraint fixes: an array of it.
        { params: [{ name: "shapes", type: S("Shape[]") }], swift: { name: "init(shapes:)" } },
      ],
      methods: [
        { name: "add", params: [{ name: "shape", type: S("Shape") }], swift: { name: "add(_:)" } },
        {
          name: "area",
          params: [],
          returns: S("double"),
          swift: { name: "area()", async: true, throws: true },
        },
      ],
      properties: [
        { name: "shapes", type: S("Shape[]"), readonly: true, swift: { name: "shapes" } },
      ],
    });
  });

  it("reads plain Swift enums as enums of case indexes, and payload enums with their cases", () => {
    expect(swiftType("Palette")).toEqual({
      kind: "enum",
      name: "Palette",
      native: "Shapes.Palette",
      symbol: at("Palette"),
      swift: { kind: "enum" },
      cases: [
        { name: "red", native: "red", value: 0 },
        { name: "green", native: "green", value: 1 },
        { name: "blue", native: "blue", value: 2 },
      ],
    });
    expect(swiftType("Shape")).toMatchObject({
      kind: "class",
      native: "Shapes.Shape",
      swift: {
        kind: "enum",
        cases: [
          {
            name: "circle",
            params: [
              { label: "center", type: S("Point") },
              { label: "radius", type: S("double") },
            ],
          },
          { name: "square", params: [{ label: "side", type: S("double") }] },
        ],
      },
    });
  });

  it("reads Swift protocols, generic functions and standard protocols' Lucent types", () => {
    expect(swiftType("Drawable")).toMatchObject({
      interface: true,
      swift: { kind: "protocol" },
      methods: [{ name: "draw", returns: S("string"), swift: { name: "draw()" } }],
    });
    expect(mod().functions).toEqual(
      expect.arrayContaining([
        {
          name: "identity",
          typeParams: ["T"],
          params: [{ name: "value", type: S("T", ["T"]) }],
          returns: S("T", ["T"]),
          swift: { name: "identity(_:)" },
          symbol: at("identity(_:)"),
        },
      ]),
    );
    // some DataProtocol is a Uint8Array, some Collection<String> a string[].
    const checksum = swiftType("Checksum");
    if (checksum.kind !== "class") throw new Error("not a class");
    expect(checksum.methods!.map((m) => [m.name, m.params[0]!.type, m.static])).toEqual([
      ["of", S("NSData"), true],
      ["joined", S("string[]"), true],
    ]);
    // ContiguousBytes: its bytes, copied out.
    expect(swiftType("Token")).toMatchObject({
      properties: [
        { name: "bytes", type: S("NSData"), readonly: true, swift: { name: "bytes", bytes: true } },
      ],
    });
  });

  it("records Swift's @MainActor as a fact, the flags following from it", () => {
    expect(swiftType("Screen")).toMatchObject({
      facts: { affinity: "main", evidence: [{ source: "attribute", detail: "@MainActor" }] },
    });
    expect(swiftType("Pen")).not.toHaveProperty("facts");
    expect(flagsNotFromFacts(modules)).toEqual([]);
  });

  it("reads main-actor types, and async and throwing getters", () => {
    expect(swiftType("Screen")).toMatchObject({
      mainActor: true,
      methods: [{ name: "show", swift: { name: "show(_:)", async: true } }],
      properties: [
        { name: "title", swift: { name: "title" } },
        { name: "ready", readonly: true, swift: { name: "ready", async: true } },
      ],
    });
  });

  it("leaves out members of enums with payloads, which are unions in Lucent", () => {
    expect(mod().skipped).toContain("Shape.sides: Swift: member of an enum with payloads");
    expect(swiftType("Stroke")).toMatchObject({
      swift: {
        kind: "enum",
        cases: [
          { name: "none", params: [] },
          { name: "solid", params: [{ type: S("double") }] },
          { name: "dashed", params: [{ type: S("double") }, { type: S("double") }] },
          {
            name: "custom",
            params: [
              { label: "name", type: S("string?") },
              { label: "width", type: S("double") },
            ],
          },
        ],
      },
    });
  });

  it("marks protocols with associated types, which Lucent classes cannot implement yet", () => {
    expect(swiftType("Container")).toMatchObject({
      swift: { kind: "protocol", associatedTypes: true },
    });
    expect(swiftType("Drawable")).toMatchObject({ swift: { kind: "protocol" } });
    expect(swiftType("Drawable")).not.toHaveProperty("swift.associatedTypes");
  });

  it("types a protocol's associated types as its type parameters, and Self as the conforming type", () => {
    expect(swiftType("Container")).toMatchObject({
      typeParams: ["Item"],
      methods: [{ name: "first", returns: S("Item?", ["Item"]) }],
    });
  });

  it("reads what protocol extensions give conforming types, their associated types resolved", () => {
    expect(swiftType("Summer")).toMatchObject({
      constructors: [
        { params: [], swift: { name: "init()" } },
        // ContiguousBytes: a Uint8Array, passed as Data.
        { params: [{ name: "seed", type: S("NSData") }], swift: { name: "init(seed:)" } },
      ],
      methods: expect.arrayContaining([
        expect.objectContaining({
          name: "total",
          static: true,
          params: [{ name: "n", type: S("NSInteger") }],
          returns: S("double"),
          swift: { name: "total(of:)" },
        }),
      ]),
    });
  });

  it("reads types nested in generic types (`Verified<Signed>.Failure`)", () => {
    expect(swiftType("Verified")).toMatchObject({
      typeParams: ["Signed"],
      swift: {
        kind: "enum",
        cases: [
          { name: "verified", params: [{ type: S("Signed", ["Signed"]) }] },
          {
            name: "unverified",
            params: [{ type: S("Signed", ["Signed"]) }, { type: S("Verified_Failure") }],
          },
        ],
      },
    });
  });

  it("reads collections constrained by their element as arrays (`Names.Element == String`)", () => {
    expect(mod().functions).toEqual(
      expect.arrayContaining([
        {
          name: "countNames",
          params: [{ name: "names", type: S("string[]") }],
          returns: S("NSInteger"),
          swift: { name: "countNames(_:)" },
          symbol: at("countNames(_:)"),
        },
      ]),
    );
  });

  it("reads statics of generic types whose extension fixes the type parameters", () => {
    expect(swiftType("Key")).toMatchObject({
      typeParams: ["Root"],
      properties: [
        {
          name: "area",
          static: true,
          type: S("Key<Canvas>"),
          swift: { name: "area", ownerArgs: [S("Canvas")] },
        },
      ],
    });
  });

  it("reads default arguments: optional at the end, omitted when Lucent has no value for them", () => {
    expect(mod().functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "greet",
          params: [
            { name: "name", type: S("string") },
            { name: "punctuation", type: S("string"), defaulted: "optional" },
            { name: "isolation", type: S("id"), defaulted: "omitted" },
          ],
        }),
      ]),
    );
  });

  it("leaves out generic initializers, which TypeScript constructors cannot declare", () => {
    expect(mod().skipped).toContain("Uses.init(tag:): Swift: generic initializer");
  });

  it("leaves out what TypeScript cannot declare: packs, and statics of generic types", () => {
    expect(mod().skipped).toEqual(
      expect.arrayContaining([
        "Box.empty(): Swift: static member of a generic type",
        "Box.each(_:): Swift: parameter packs",
        "Shapes.broken(): refers to Shapes.Broken, which is not declared",
      ]),
    );
    expect(swiftType("Uses")).toMatchObject({
      methods: [{ name: "boxed", returns: S("Box<Point>") }],
    });
  });

  it("leaves out operators and the members protocols supply by default", () => {
    expect(mod().skipped!.filter((s) => s.includes("=="))).toEqual([]);
    expect(mod().skipped!.filter((s) => s.includes("!="))).toEqual([]);
    expect(mod().skipped!.filter((s) => s.includes("Swift-only"))).toEqual([]);
  });
});

describe.skipIf(!xcode)("iOS extractor, requirements Lucent classes implement", () => {
  const dir = xcode ? swiftModule("Orbit") : "";
  const modules = xcode ? extractIos({ modules: ["Orbit"], includePaths: [dir] }) : [];
  const mod = () => modules.find((m) => m.module === "Orbit")!;
  const swiftType = (name: string) => {
    const t = mod().types.find((x) => x.name === name);
    if (!t) throw new Error(`no type ${name}`);
    return t;
  };
  const S = (s: string, tps: string[] = []) => parseSchemaType(s, "Orbit", tps);
  const self = { k: "tparam", name: "Self", nullable: false };

  it("reads property, throwing, async and mutating requirements", () => {
    expect(swiftType("Source")).toMatchObject({
      interface: true,
      swift: { kind: "protocol" },
      properties: [
        { name: "name", type: S("string"), readonly: true },
        { name: "limit", type: S("double"), swift: { name: "limit" } },
      ],
      methods: [
        { name: "titles", swift: { name: "titles()", throws: true } },
        { name: "fetch", swift: { name: "fetch(_:)", async: true, throws: true } },
        { name: "count", swift: { name: "count()", async: true } },
        { name: "reset", swift: { name: "reset()", mutating: true } },
      ],
    });
    expect(swiftType("Source")).not.toHaveProperty("swift.associatedTypes");
  });

  it("types associated types as type parameters, the primary ones first", () => {
    expect(swiftType("Store")).toMatchObject({
      typeParams: ["Item"],
      swift: { kind: "protocol", associatedTypes: true, primaryAssociatedTypes: ["Item"] },
      methods: [
        { name: "load", params: [], returns: S("Item?", ["Item"]) },
        { name: "save", params: [{ type: S("Item", ["Item"]) }], returns: S("bool") },
      ],
    });
    // `some Store<String>`: the protocol, with the associated type it names.
    expect(swiftType("Stores")).toMatchObject({
      methods: [{ name: "swap", params: [{ type: S("Store<string>") }, { type: S("string") }] }],
    });
    expect(mod().skipped).toEqual([]);
  });

  it("types Self in a requirement as the type that conforms", () => {
    expect(swiftType("Ranked")).toMatchObject({
      swift: { kind: "protocol", associatedTypes: true },
      methods: [
        { name: "outranks", params: [{ type: self }], returns: S("bool") },
        { name: "best", params: [], returns: self },
      ],
    });
    expect(swiftType("Ranked")).not.toHaveProperty("typeParams");
  });
});
