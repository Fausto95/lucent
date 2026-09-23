import { describe, expect, it } from "vitest";
import { sdkDts } from "../src/sdk/dts.ts";
import { parseSdkType } from "../src/sdk/schema.ts";

describe("schema types", () => {
  it("parses the forms schemas use", () => {
    expect(parseSdkType("string?")).toEqual({ k: "string", nullable: true });
    expect(parseSdkType("Foundation.NSURL[]")).toEqual({ k: "array", of: { k: "ref", module: "Foundation", name: "NSURL", nullable: false }, nullable: false });
    expect(parseSdkType("Record<id>?")).toEqual({ k: "record", of: { k: "id", nullable: false }, nullable: true });
    expect(parseSdkType("Out<CFTypeRef>?")).toEqual({ k: "out", of: { k: "id", nullable: false, cf: true }, nullable: true });
    expect(parseSdkType("Widget", "com.example")).toEqual({ k: "ref", module: "com.example", name: "Widget", nullable: false });
    expect(parseSdkType("T[]", "", ["T"])).toEqual({ k: "array", of: { k: "tparam", name: "T", nullable: false }, nullable: false });
  });

  it("parses blocks: parameters, result, whether they escape and run on the main thread", () => {
    const bool = { k: "prim", name: "bool", nullable: false };
    expect(parseSdkType("@escaping @main (bool, error?) => void")).toEqual({
      k: "fn",
      params: [bool, { k: "error", nullable: true }],
      ret: { k: "prim", name: "void", nullable: false },
      escaping: true,
      main: true,
      nullable: false,
    });
    expect(parseSdkType("(string) => bool")).toMatchObject({ k: "fn", params: [{ k: "string" }], ret: bool, escaping: false, main: false });
    // An optional block is stored, so it escapes.
    expect(parseSdkType("(@main (bool) => void)?")).toMatchObject({ k: "fn", params: [bool], escaping: true, main: true, nullable: true });
    expect(parseSdkType("@escaping ((string) => void, NSData?) => void")).toMatchObject({ k: "fn", params: [{ k: "fn", params: [{ k: "string" }] }, { k: "bytes", nullable: true }] });
  });
});

describe("SDK declarations", () => {
  const dts = sdkDts({
    platform: "ios",
    module: "Widgets",
    types: [
      {
        kind: "class",
        name: "WDGLoader",
        native: "WDGLoader",
        methods: [
          { name: "observe", selector: "observeWithBlock:", params: [{ name: "block", type: "@escaping (string, NSInteger, id) => void" }], returns: "void" },
          { name: "load", selector: "loadWithReply:", params: [{ name: "reply", type: "@escaping (NSData?, error?) => void" }], returns: "void", async: { returns: "NSData", throws: true } },
          { name: "countWhere", selector: "countWhere:", params: [{ name: "predicate", type: "@main (string) => bool" }], returns: "NSInteger" },
          { name: "getItems", selector: "getItemsWithCompletionHandler:", params: [{ name: "completionHandler", type: "@escaping (string[]) => void" }], returns: "void", async: { returns: "string[]", name: "items" } },
        ],
      },
    ],
  });

  it("types blocks as functions of Lucent values", () => {
    expect(dts).toContain("  observe(block: (arg0: string, arg1: number, arg2: NSObject) => void): void;");
    expect(dts).toContain("  countWhere(predicate: (arg0: string) => boolean): number;");
  });

  it("adds a promise overload for completion handlers Swift imports as async", () => {
    expect(dts).toContain("  load(reply: (arg0: Uint8Array | null, arg1: Error | null) => void): void;");
    expect(dts).toContain("  load(): Promise<Uint8Array>;");
    // Under the name Swift gives the async form.
    expect(dts).toContain("  getItems(completionHandler: (arg0: string[]) => void): void;");
    expect(dts).toContain("  items(): Promise<string[]>;");
  });
});
