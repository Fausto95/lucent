/**
 * iOS schemas from symbol graphs written here (the shapes
 * swift-symbolgraph-extract writes), so they are read on any machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  buildIosSchemas,
  extensionGraphs,
  externalUsrs,
  namesOf,
  withExtensions,
  withRootExtensions,
} from "../src/ios.ts";
import type { SymbolGraph, SymbolGraphSymbol } from "../src/symbols.ts";

const ios17 = [{ domain: "iOS", introduced: { major: 17 } }];

function sym(
  kind: string,
  usr: string,
  path: string[],
  extra: Partial<SymbolGraphSymbol> = {},
): SymbolGraphSymbol {
  return {
    kind: { identifier: kind },
    identifier: { precise: usr },
    pathComponents: path,
    names: { title: path.at(-1)! },
    ...extra,
  };
}

const DOUBLE = { kind: "typeIdentifier", spelling: "Double", preciseIdentifier: "s:Sd" };

/** A module Kit: an enum, a typed string key, a C function and a C global. */
const graph: SymbolGraph = {
  symbols: [
    sym("swift.enum", "c:@E@KITMode", ["KITMode"]),
    sym("swift.enum.case", "c:@E@KITMode@KITModePlain", ["KITMode", "plain"]),
    sym("swift.enum.case", "c:@E@KITMode@KITModeVivid", ["KITMode", "vivid"], {
      availability: ios17,
    }),
    sym("swift.struct", "c:Kit.h@T@KITKey", ["KITKey"]),
    sym("swift.type.property", "c:@KITKeyOld", ["KITKey", "old"]),
    sym("swift.type.property", "c:@KITKeyFresh", ["KITKey", "fresh"], { availability: ios17 }),
    sym("swift.func", "c:@F@KITNow", ["KITNow()"], {
      names: { title: "KITNow()" },
      functionSignature: { parameters: [], returns: [DOUBLE] },
      availability: ios17,
    }),
    sym("swift.var", "c:@KITLimit", ["KITLimit"], {
      declarationFragments: [{ kind: "text", spelling: "var KITLimit: " }, DOUBLE],
      availability: ios17,
    }),
  ],
  relationships: [
    { kind: "memberOf", source: "c:@E@KITMode@KITModePlain", target: "c:@E@KITMode" },
    { kind: "memberOf", source: "c:@E@KITMode@KITModeVivid", target: "c:@E@KITMode" },
    { kind: "memberOf", source: "c:@KITKeyOld", target: "c:Kit.h@T@KITKey" },
    { kind: "memberOf", source: "c:@KITKeyFresh", target: "c:Kit.h@T@KITKey" },
  ],
};

const values = () =>
  new Map([
    [
      "KITMode",
      new Map([
        ["KITModePlain", 0],
        ["KITModeVivid", 1],
      ]),
    ],
  ]);

describe("iOS schemas from symbol graphs", () => {
  const [kit] = buildIosSchemas(new Map([["Kit", graph]]), values);
  const type = (name: string) => kit!.types.find((t) => t.name === name)!;

  it("record when C functions, globals, typed string keys and enum cases appeared", () => {
    expect(kit!.functions?.find((f) => f.name === "KITNow")).toMatchObject({ since: "17.0" });
    expect(kit!.constants?.find((c) => c.name === "KITLimit")).toMatchObject({ since: "17.0" });

    const key = type("KITKey");
    if (key.kind !== "class") throw new Error("not a class");
    expect(key.properties?.find((p) => p.name === "fresh")).toMatchObject({ since: "17.0" });
    expect(key.properties?.find((p) => p.name === "old")).not.toHaveProperty("since");

    const mode = type("KITMode");
    if (mode.kind !== "enum") throw new Error("not an enum");
    expect(mode.cases).toEqual([
      { name: "plain", native: "KITModePlain", value: 0 },
      { name: "vivid", native: "KITModeVivid", value: 1, since: "17.0" },
    ]);
  });
});

describe("Swift async sequences in symbol graphs", () => {
  // StoreKit's shape: Transaction.updates is a Transaction.Transactions, an AsyncSequence of
  // VerificationResult<Transaction>; here its elements are Transactions themselves.
  const T = "s:5Store11TransactionV";
  const TS = "s:5Store11TransactionV12TransactionsV";
  const ref = (name: string, usr: string) => ({
    kind: "typeIdentifier",
    spelling: name,
    preciseIdentifier: usr,
  });
  const store: SymbolGraph = {
    symbols: [
      sym("swift.struct", T, ["Transaction"]),
      sym("swift.struct", TS, ["Transaction", "Transactions"]),
      sym("swift.typealias", `${TS}7Elementa`, ["Transaction", "Transactions", "Element"], {
        declarationFragments: [
          { kind: "keyword", spelling: "typealias" },
          { kind: "text", spelling: " Element = " },
          ref("Transaction", T),
        ],
      }),
      sym("swift.type.property", `${T}7updatesAC12TransactionsVvpZ`, ["Transaction", "updates"], {
        declarationFragments: [
          { kind: "text", spelling: "static var updates: " },
          ref("Transaction", T),
          { kind: "text", spelling: "." },
          ref("Transactions", TS),
          { kind: "text", spelling: " { get }" },
        ],
      }),
      sym("swift.type.method", `${T}6countsScSySiGyFZ`, ["Transaction", "counts()"], {
        names: { title: "counts()" },
        declarationFragments: [{ kind: "text", spelling: "static func counts() -> " }],
        functionSignature: {
          parameters: [],
          returns: [
            ref("AsyncStream", "s:ScS"),
            { kind: "text", spelling: "<" },
            ref("Int", "s:Si"),
            { kind: "text", spelling: ">" },
          ],
        },
      }),
    ],
    relationships: [
      { kind: "memberOf", source: TS, target: T },
      { kind: "memberOf", source: `${TS}7Elementa`, target: TS },
      { kind: "conformsTo", source: TS, target: "s:Sci" },
      { kind: "memberOf", source: `${T}7updatesAC12TransactionsVvpZ`, target: T },
      { kind: "memberOf", source: `${T}6countsScSySiGyFZ`, target: T },
    ],
  };

  it("bind AsyncStreams and the module's AsyncSequence types as sequences of their elements", () => {
    const [schema] = buildIosSchemas(new Map([["Store", store]]), () => new Map());
    const transaction = schema!.types.find((t) => t.name === "Transaction");
    if (transaction?.kind !== "class") throw new Error("no Transaction");

    expect(transaction.properties?.find((p) => p.name === "updates")).toMatchObject({
      static: true,
      type: { k: "sequence", of: { k: "ref", module: "Store", name: "Transaction" } },
    });
    expect(transaction.methods?.find((m) => m.name === "counts")).toMatchObject({
      returns: { k: "sequence", of: { k: "prim", name: "NSInteger" } },
    });
    // The sequence type itself is the sequence, not a class of its own.
    expect(schema!.types.map((t) => t.name)).not.toContain("Transaction_Transactions");
  });
});

describe("members a module adds to NSObject", () => {
  // Where swift-symbolgraph-extract puts a category on another module's class: the module's
  // extension graph for that module (Kit@ObjectiveC.symbols.json), members of NSObject's USR.
  const STRING = { kind: "typeIdentifier", spelling: "String", preciseIdentifier: "s:SS" };
  const BOOL = { kind: "typeIdentifier", spelling: "Bool", preciseIdentifier: "s:Sb" };
  const NSOBJECT = "c:objc(cs)NSObject";
  const kit: SymbolGraph = {
    symbols: [sym("swift.class", "c:objc(cs)KITView", ["KITView"])],
    relationships: [{ kind: "inheritsFrom", source: "c:objc(cs)KITView", target: NSOBJECT }],
  };
  const objc: SymbolGraph = {
    symbols: [
      sym("swift.property", `${NSOBJECT}(py)kitLabel`, ["NSObject", "kitLabel"], {
        declarationFragments: [
          { kind: "keyword", spelling: "var" },
          { kind: "text", spelling: " " },
          { kind: "identifier", spelling: "kitLabel" },
          { kind: "text", spelling: ": " },
          STRING,
          { kind: "text", spelling: "? { get set }" },
        ],
      }),
      sym("swift.method", `${NSOBJECT}(im)kitActivate`, ["NSObject", "kitActivate()"], {
        names: { title: "kitActivate()" },
        declarationFragments: [{ kind: "text", spelling: "func kitActivate() -> " }, BOOL],
        functionSignature: { parameters: [], returns: [BOOL] },
      }),
      sym("swift.method", `${NSOBJECT}(im)kitValueForKey:`, ["NSObject", "kitValue(forKey:)"], {
        names: { title: "kitValue(forKey:)" },
        declarationFragments: [
          { kind: "text", spelling: "func kitValue(forKey key: " },
          STRING,
          { kind: "text", spelling: ") -> " },
          STRING,
        ],
        functionSignature: {
          parameters: [{ name: "key", declarationFragments: [STRING] }],
          returns: [STRING],
        },
      }),
      // A Swift extension's member, which no message reaches.
      sym("swift.method", "s:So8NSObjectC3KitE5kitGoyyF", ["NSObject", "kitGo()"], {
        names: { title: "kitGo()" },
        functionSignature: { parameters: [], returns: [] },
      }),
    ],
    relationships: [
      { kind: "memberOf", source: `${NSOBJECT}(py)kitLabel`, target: NSOBJECT },
      { kind: "memberOf", source: `${NSOBJECT}(im)kitActivate`, target: NSOBJECT },
      { kind: "memberOf", source: `${NSOBJECT}(im)kitValueForKey:`, target: NSOBJECT },
      { kind: "memberOf", source: "s:So8NSObjectC3KitE5kitGoyyF", target: NSOBJECT },
    ],
  };
  const merged = withRootExtensions(kit, objc);
  const root: SymbolGraph = {
    symbols: [sym("swift.class", NSOBJECT, ["NSObject"])],
    relationships: [],
  };
  const [, schema] = buildIosSchemas(
    new Map([
      ["ObjectiveC", root],
      ["Kit", merged],
    ]),
    () => new Map(),
  );

  it("are a class of the module's own, an extension of NSObject's, with no constructor", () => {
    const added = schema!.types.find((t) => t.name === "NSObject_Kit");
    if (added?.kind !== "class") throw new Error("no NSObject_Kit");

    expect(added).toMatchObject({ native: "NSObject", extensionOf: "ObjectiveC.NSObject" });
    expect(added.constructors ?? []).toEqual([]);
    expect(added.properties?.map((p) => [p.name, p.setter])).toEqual([
      ["kitLabel", "setKitLabel:"],
    ]);
    // Its methods keep their labels: a subclass elsewhere may name a member kitValue.
    expect(added.methods?.map((m) => [m.name, m.selector])).toEqual([
      ["kitActivate", "kitActivate"],
      ["kitValueForKey", "kitValueForKey:"],
    ]);
  });

  it("leave NSObject another module's: Kit's classes still extend it", () => {
    const view = schema!.types.find((t) => t.name === "KITView");

    expect(view).toMatchObject({ extends: "ObjectiveC.NSObject" });
    // Declared as the class its members name as their owner, which no reference names.
    expect(namesOf("Kit", merged).types).not.toHaveProperty("NSObject");
    expect(namesOf("Kit", merged).types.NSObject_Kit).toEqual({
      kind: "class",
      native: "NSObject",
    });
    expect(Object.values(namesOf("Kit", merged).refs)).not.toContain("Kit.NSObject_Kit");
    expect(externalUsrs(merged)).toContain(NSOBJECT);
  });

  it("are nothing without the extension graph", () => {
    expect(withRootExtensions(kit, undefined)).toBe(kit);
  });
});

describe("members a module adds to another module's class", () => {
  // UIKit's NSIndexPath (UIKitAdditions): in UIKit@Foundation.symbols.json, members of
  // Foundation's class.
  const INT = { kind: "typeIdentifier", spelling: "Int", preciseIdentifier: "s:Si" };
  const PATH = "c:objc(cs)NSIndexPath";
  const getter = (name: string) => [
    { kind: "keyword", spelling: "var" },
    { kind: "text", spelling: " " },
    { kind: "identifier", spelling: name },
    { kind: "text", spelling: ": " },
    INT,
    { kind: "text", spelling: " { get }" },
  ];
  const kit: SymbolGraph = {
    symbols: [sym("swift.class", "c:objc(cs)KITTable", ["KITTable"])],
    relationships: [],
  };
  const foundation: SymbolGraph = {
    symbols: [
      sym("swift.property", `${PATH}(py)row`, ["NSIndexPath", "row"], {
        declarationFragments: getter("row"),
      }),
      sym("swift.property", `${PATH}(py)section`, ["NSIndexPath", "section"], {
        declarationFragments: getter("section"),
      }),
      // +indexPathForRow:inSection:, which Swift imports as an initializer.
      sym(
        "swift.init",
        `${PATH}(cm)indexPathForRow:inSection:`,
        ["NSIndexPath", "init(row:section:)"],
        {
          names: { title: "init(row:section:)" },
          declarationFragments: [
            { kind: "keyword", spelling: "convenience" },
            { kind: "text", spelling: " " },
            { kind: "keyword", spelling: "init" },
            { kind: "text", spelling: "(row: " },
            INT,
            { kind: "text", spelling: ", section: " },
            INT,
            { kind: "text", spelling: ")" },
          ],
          functionSignature: {
            parameters: [
              { name: "row", declarationFragments: [INT] },
              { name: "section", declarationFragments: [INT] },
            ],
          },
        },
      ),
    ],
    relationships: [
      { kind: "memberOf", source: `${PATH}(py)row`, target: PATH },
      { kind: "memberOf", source: `${PATH}(py)section`, target: PATH },
      { kind: "memberOf", source: `${PATH}(cm)indexPathForRow:inSection:`, target: PATH },
    ],
  };
  const merged = withExtensions(kit, new Map([["Foundation", foundation]]));
  const own: SymbolGraph = {
    symbols: [sym("swift.class", PATH, ["NSIndexPath"])],
    relationships: [],
  };
  const [, schema] = buildIosSchemas(
    new Map([
      ["Foundation", own],
      ["Kit", merged],
    ]),
    () => new Map(),
  );

  it("are a class of the module's own, an extension of that class", () => {
    const added = schema!.types.find((t) => t.name === "NSIndexPath_Kit");
    if (added?.kind !== "class") throw new Error("no NSIndexPath_Kit");

    expect(added).toMatchObject({ native: "NSIndexPath", extensionOf: "Foundation.NSIndexPath" });
    expect(added.constructors ?? []).toEqual([]);
    expect(added.properties?.map((p) => p.name)).toEqual(["row", "section"]);
    expect(externalUsrs(merged)).toContain(PATH);
    // Its initializer, a class method sent to the class, giving that class's object.
    expect(added.methods).toEqual([
      expect.objectContaining({
        name: "indexPathForRowInSection",
        static: true,
        selector: "indexPathForRow:inSection:",
        returns: { k: "ref", module: "Foundation", name: "NSIndexPath", nullable: false },
      }),
    ]);
    expect(added.methods![0]).not.toHaveProperty("initializer");
  });

  it("come from each extension graph of the module, by the module it extends", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-extensions-"));
    for (const f of [
      "Kit.symbols.json",
      "Kit@Foundation.symbols.json",
      "Kit@ObjectiveC.symbols.json",
      "KitExtras@Foundation.symbols.json",
    ])
      fs.writeFileSync(path.join(dir, f), JSON.stringify({ symbols: [], relationships: [] }));

    expect([
      ...extensionGraphs(dir, "Kit", () => ({ symbols: [], relationships: [] })).keys(),
    ]).toEqual(["Foundation", "ObjectiveC"]);
    expect(extensionGraphs(path.join(dir, "missing"), "Kit", () => undefined).size).toBe(0);
  });

  it("leave a class the module declares itself as it is", () => {
    const declares: SymbolGraph = {
      ...kit,
      symbols: [...kit.symbols, sym("swift.class", PATH, ["NSIndexPath"])],
    };
    expect(withExtensions(declares, new Map([["Foundation", foundation]]))).toBe(declares);
  });
});

describe("Swift subscripts", () => {
  const G = "s:4Grid0A0V";
  const INT = { kind: "typeIdentifier", spelling: "Int", preciseIdentifier: "s:Si" };
  const STRING = { kind: "typeIdentifier", spelling: "String", preciseIdentifier: "s:SS" };
  const text = (spelling: string) => ({ kind: "text", spelling });
  const param = (name: string, type: typeof INT) => ({
    name,
    declarationFragments: [{ kind: "internalParam", spelling: name }, text(": "), type],
  });
  const subscript = (
    usr: string,
    title: string,
    params: [string, typeof INT][],
    returns: typeof INT,
    accessors: string,
    kind = "swift.subscript",
  ) =>
    sym(kind, `${G}${usr}`, ["Grid", title], {
      names: { title },
      declarationFragments: [
        ...(kind === "swift.type.subscript"
          ? [{ kind: "keyword", spelling: "static" }, text(" ")]
          : []),
        { kind: "keyword", spelling: "subscript" },
        text("("),
        ...params.flatMap(([n, t], i) => [
          ...(i ? [text(", ")] : []),
          { kind: "internalParam", spelling: n },
          text(": "),
          t,
        ]),
        text(") -> "),
        returns,
        // The accessors' words are keywords: `{ get async throws }`.
        text(" { "),
        ...accessors
          .split(" ")
          .flatMap((w, i) => [...(i ? [text(" ")] : []), { kind: "keyword", spelling: w }]),
        text(" }"),
      ],
      functionSignature: { parameters: params.map(([n, t]) => param(n, t)), returns: [returns] },
    });
  const graph: SymbolGraph = {
    symbols: [
      sym("swift.struct", G, ["Grid"]),
      subscript(
        "cell",
        "subscript(_:_:)",
        [
          ["row", INT],
          ["column", INT],
        ],
        DOUBLE,
        "get set",
      ),
      subscript("named", "subscript(_:)", [["name", STRING]], DOUBLE, "get async throws"),
      subscript("shared", "subscript(_:)", [["key", STRING]], INT, "get", "swift.type.subscript"),
    ],
    relationships: ["cell", "named", "shared"].map((u) => ({
      kind: "memberOf",
      source: `${G}${u}`,
      target: G,
    })),
  };

  it("are the methods subscript and, when they can be set, setSubscript", () => {
    const [schema] = buildIosSchemas(new Map([["Grid", graph]]), () => new Map());
    const grid = schema!.types.find((t) => t.name === "Grid");
    if (grid?.kind !== "class") throw new Error("no Grid");

    const shown = grid.methods!.map((m) => [
      m.name,
      !!m.static,
      m.params.map((p) => p.name),
      m.swift,
    ]);
    expect(shown).toEqual([
      ["subscript", false, ["row", "column"], { name: "subscript(_:_:)", subscript: "get" }],
      [
        "setSubscript",
        false,
        ["row", "column", "newValue"],
        { name: "subscript(_:_:)", subscript: "set" },
      ],
      [
        "subscript",
        false,
        ["name"],
        { name: "subscript(_:)", subscript: "get", async: true, throws: true },
      ],
      ["subscript", true, ["key"], { name: "subscript(_:)", subscript: "get" }],
    ]);
    expect(grid.methods![1]!.params[2]!.type).toEqual(grid.methods![0]!.returns);
    expect(schema!.skipped ?? []).toEqual([]);
  });
});
