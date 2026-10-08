// How a SwiftUI body reads the values its C++ glue passes: checked casts that
// name the value, never `as!`, which would stop with a bare cast failure.
import { swift } from "@lucent-lang/codegen";
import { describe, expect, it } from "vite-plus/test";
import { SwiftValues } from "../../src/emit/swiftui.ts";

const unit = (decls: swift.Decl[]) => swift.printUnit({ banner: "test", decls });

describe("SwiftUI values", () => {
  it("decode with checked casts that report the value and what it holds", () => {
    const values = new SwiftValues("Gallery");
    const x = swift.name("x");
    const read = [
      values.decode({ k: "number" }, x, "count"),
      values.decode({ k: "boolean" }, x, "on"),
      values.decode({ k: "string" }, x, "title"),
      values.decode({ k: "array", element: { k: "number" } }, x, "sizes"),
      values.decode({ k: "nullable", inner: { k: "string" } }, x, "subtitle"),
      values.decode(
        { k: "object", fields: [{ name: "label", type: { k: "string" }, optional: false }] },
        x,
        "item",
      ),
    ].map(swift.printExpr);

    expect(read).toEqual([
      'lucentDecodeNumber(x, "count").doubleValue',
      'lucentDecodeNumber(x, "on").boolValue',
      'lucentDecodeString(x, "title")',
      'lucentDecodeList(x, "sizes").map { lucentDecodeNumber($0, "sizes[]").doubleValue }',
      '(x as? NSNull == nil ? lucentDecodeString(x, "subtitle") : nil) as String?',
      "GalleryValue0(x)",
    ]);

    const text = unit([...SwiftValues.decoders(), ...values.structs]);

    expect(text).not.toContain("as!");
    expect(text).toContain('let fields = lucentDecodeList(x, "GalleryValue0")');
    expect(text).toContain('f0 = lucentDecodeString(fields[0], "GalleryValue0.label")');
    expect(text).toContain(
      [
        "fileprivate func lucentDecodeNumber(_ x: Any, _ what: String) -> NSNumber {",
        "  if let value = x as? NSNumber {",
        "    return value",
        "  }",
        '  fatalError("Lucent: " + what + " should be a number, got " + String(describing: type(of: x)))',
        "}",
      ].join("\n"),
    );
  });
});
