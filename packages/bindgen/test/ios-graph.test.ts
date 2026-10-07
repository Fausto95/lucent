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

const values = () => new Map([["KITMode", new Map([["KITModePlain", 0], ["KITModeVivid", 1]])]]);

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
