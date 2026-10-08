/**
 * iOS schemas from symbol graphs written here (the shapes
 * swift-symbolgraph-extract writes), so they are read on any machine.
 */
import { describe, expect, it } from "vite-plus/test";
import { buildIosSchemas } from "../src/ios.ts";
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
