import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ownerOf, scanHeaders } from "../src/header-index.ts";

/** `text` written as a header in a fresh directory. */
function header(name: string, text: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-headers-")), name);
  fs.writeFileSync(file, text);
  return file;
}

describe("the header index", () => {
  it("indexes CoreFoundation's enum macros", () => {
    const index: Record<string, string> = {};
    scanHeaders(index, "CoreText", [
      header(
        "CTFont.h",
        `typedef CF_ENUM(uint32_t, CTFontOrientation) { kCTFontOrientationDefault = 0 };
typedef CF_OPTIONS(uint32_t, CTFontSymbolicTraits) { kCTFontTraitItalic = 1 };
typedef CF_CLOSED_ENUM(CFIndex, CTWritingDirection) { kCTWritingDirectionNatural = -1 };
`,
      ),
    ]);

    expect(index).toMatchObject({
      CTFontOrientation: "CoreText",
      CTFontSymbolicTraits: "CoreText",
      CTWritingDirection: "CoreText",
    });
  });

  it("leaves a class to the module declaring it, not one adding a category to it", () => {
    const index: Record<string, string> = {};
    // UIKit's NSAttributedString (UIKitAdditions), scanned before Foundation.
    scanHeaders(index, "UIKit", [
      header(
        "NSAttributedString+UIKit.h",
        "@interface NSAttributedString (UIKitAdditions)\n@end\n@interface NSMutableAttributedString(NSAttributedStringKitAdditions)\n@end\n@interface UIView : UIResponder\n@end\n",
      ),
    ]);
    scanHeaders(index, "Foundation", [
      header("NSAttributedString.h", "@interface NSAttributedString : NSObject\n@end\n"),
    ]);

    expect(index.NSAttributedString).toBe("Foundation");
    expect(index.NSMutableAttributedString).toBeUndefined();
    expect(index.UIView).toBe("UIKit");
  });

  it("takes a USR's module from the symbol graph where it names one", () => {
    expect(ownerOf("c:objc(cs)NSObject", {}, { "c:objc(cs)NSObject": "ObjectiveC" })).toBe(
      "ObjectiveC",
    );
    expect(ownerOf("c:objc(cs)NSObject", { NSObject: "Foundation" })).toBe("Foundation");
  });
});
