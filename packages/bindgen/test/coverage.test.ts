import { describe, expect, it } from "vitest";
import { coverage } from "../src/coverage.ts";

describe("SDK coverage", () => {
  it("counts members as idiomatic (reached through a rule), raw, or unrepresentable (skipped)", () => {
    const c = coverage({
      platform: "ios",
      module: "Widgets",
      types: [
        {
          kind: "class",
          name: "WDGLoader",
          native: "WDGLoader",
          constructors: [{ params: [], selector: "init" }],
          methods: [
            { name: "load", selector: "loadWithReply:", params: [{ name: "reply", type: "@escaping (NSData?, error?) => void" }], returns: "void", async: { returns: "NSData", throws: true } },
            { name: "cancel", selector: "cancel", params: [], returns: "void" },
          ],
          properties: [{ name: "name", type: "string", getter: "getName", readonly: true }, { name: "label", type: "string?" }],
        },
        { kind: "enum", name: "WDGStyle", native: "WDGStyle", cases: [{ name: "light", native: "WDGStyleLight", value: 0 }] },
      ],
      functions: [{ name: "WDGDistance", params: [], returns: "double" }],
      constants: [{ name: "WDGVersion", type: "string" }],
      skipped: ["WDGWidget.frame(_:): CGRect", "WDGWidget.origin(): pointer to double"],
    });
    // load (a promise), name (a getter as a property); init, cancel, label, WDGDistance, WDGVersion.
    expect(c).toEqual({ module: "Widgets", idiomatic: 2, raw: 5, unrepresentable: 2, total: 9, reasons: { CGRect: 1, "pointer to double": 1 } });
  });
});
