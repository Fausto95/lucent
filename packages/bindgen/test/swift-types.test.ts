import { describe, expect, it } from "vite-plus/test";
import { parseSchemaType } from "../src/schema.ts";
import {
  afterColon,
  type Fragment,
  parseType,
  propertyType,
  type Resolver,
  Unsupported,
} from "../src/symbols.ts";

/** Declaration fragments: strings are text, `[spelling, usr]` pairs type identifiers. */
const frags = (...parts: (string | [string, string])[]): Fragment[] =>
  parts.map((p) =>
    typeof p === "string"
      ? { kind: "text", spelling: p }
      : { kind: "typeIdentifier", spelling: p[0], preciseIdentifier: p[1] },
  );

/** Objective-C types of a module `Kit`, and Foundation's NSCopying protocol. */
const resolver: Resolver = {
  ref: (usr) =>
    ({
      "c:objc(cs)KITView": "Kit.KITView",
      "c:objc(pl)NSCopying": "Foundation.NSCopying",
      "c:objc(pl)NSSecureCoding": "Foundation.NSSecureCoding",
    })[usr],
  alias: () => undefined,
  typedef: () => undefined,
};

/** The reason a type has no schema type. */
const reason = (...parts: (string | [string, string])[]) => {
  try {
    parseType(frags(...parts), resolver);
  } catch (e) {
    if (e instanceof Unsupported) return e.message;
    throw e;
  }
  return undefined;
};

const NSOBJECT_PROTOCOL: [string, string] = ["NSObjectProtocol", "c:objc(pl)NSObject"];
const NSCOPYING: [string, string] = ["NSCopying", "c:objc(pl)NSCopying"];

describe("Swift types without a Lucent value", () => {
  it("names what each ABI type is, and why it has no value", () => {
    expect(reason(["Selector", "s:10ObjectiveC8SelectorV"])).toBe(
      "Objective-C selectors (Selector) have no Lucent value yet",
    );
    expect(reason(["AnyClass", "s:s8AnyClassa"])).toBe(
      "class objects (AnyClass) have no Lucent value yet",
    );
    expect(reason(["UnsafeRawPointer", "s:SV"])).toBe(
      "raw pointers (UnsafeRawPointer) have no Lucent value: nothing says what they point to",
    );
    expect(reason(["UnsafePointer", "s:SP"], "<", ["UInt8", "s:s5UInt8V"], ">")).toBe(
      "pointers to read (UnsafePointer) have no Lucent value yet: nothing ties them to their length",
    );
    expect(reason(["UnsafeRawBufferPointer", "s:SW"])).toBe(
      "buffer pointers (UnsafeRawBufferPointer) have no Lucent value yet",
    );
    expect(reason(["NSZone", "s:10ObjectiveC6NSZoneV"], "?")).toBe(
      "memory zones (NSZone) have no Lucent value",
    );
    expect(reason(["KITView", "c:objc(cs)KITView"], ".Type")).toBe(
      "metatypes (KITView.Type) have no Lucent value yet",
    );
  });

  it("reads a protocol composed with NSObjectProtocol as the protocol: every object is one", () => {
    expect(parseType(frags("any ", NSCOPYING, " & ", NSOBJECT_PROTOCOL), resolver)).toEqual(
      parseSchemaType("Foundation.NSCopying"),
    );
    expect(parseType(frags("(any ", NSOBJECT_PROTOCOL, " & ", NSCOPYING, ")?"), resolver)).toEqual(
      parseSchemaType("Foundation.NSCopying?"),
    );
  });

  it("refuses other compositions: a value of two types at once", () => {
    expect(reason("any ", NSCOPYING, " & ", ["NSSecureCoding", "c:objc(pl)NSSecureCoding"])).toBe(
      "values of several types at once (NSCopying & NSSecureCoding) have no Lucent type yet",
    );
    expect(reason(["KITView", "c:objc(cs)KITView"], " & ", NSCOPYING)).toBe(
      "values of several types at once (KITView & NSCopying) have no Lucent type yet",
    );
  });
});

describe("declaration fragments", () => {
  it("read a type after attributes whose arguments hold a colon", () => {
    // StoreKit's Transaction.currentEntitlements: `@backDeployed(before: iOS 18.0) static var …`.
    const decl = frags(
      "",
      "@backDeployed",
      "(before: iOS 18.0)\n",
      "static var currentEntitlements: ",
      ["KITView", "c:objc(cs)KITView"],
      " { get }",
    );
    decl[1]!.kind = "attribute";

    expect(parseType(propertyType(decl), resolver)).toEqual(parseSchemaType("Kit.KITView"));
    expect(parseType(afterColon(decl.slice(0, 5)), resolver)).toEqual(
      parseSchemaType("Kit.KITView"),
    );
  });
});

describe("Swift async sequences", () => {
  const INT: [string, string] = ["Int", "s:Si"];
  const parse = (...parts: (string | [string, string])[]) => {
    const f = frags(...parts);
    return parseType(f, resolver);
  };

  it("read AsyncStream, AsyncThrowingStream and some AsyncSequence as sequences of their elements", () => {
    const ints = parseSchemaType("AsyncSequence<NSInteger>");

    expect(parse(["AsyncStream", "s:ScS"], "<", INT, ">")).toEqual(ints);
    expect(
      parse(["AsyncThrowingStream", "s:Scs"], "<", INT, ", ", ["Error", "s:s5ErrorP"], ">"),
    ).toEqual(ints);
    expect(
      parse("some ", ["AsyncSequence", "s:Sci"], "<", INT, ", ", ["Never", "s:s5NeverO"], ">"),
    ).toEqual(ints);
    expect(parse(["AsyncStream", "s:ScS"], "<", ["KITView", "c:objc(cs)KITView"], ">?")).toEqual(
      parseSchemaType("AsyncSequence<Kit.KITView>?"),
    );
  });
});
