import { describe, expect, it } from "vite-plus/test";
import { type Coverage, coverage, coverageSummary } from "../src/coverage.ts";
import { parseSchemaType, SCHEMA_FORMAT, type SdkModuleSchema } from "../src/schema.ts";
import { sdkSymbols, symbolKey } from "../src/usage.ts";

/** A schema type from its written form (`string?`, `Widgets.WDGWidget`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

const widgets = (): SdkModuleSchema => ({
  format: SCHEMA_FORMAT,
  platform: "ios",
  module: "Widgets",
  types: [
    {
      kind: "class",
      name: "WDGLoader",
      native: "WDGLoader",
      constructors: [{ params: [], selector: "init" }],
      methods: [
        {
          name: "load",
          selector: "loadWithReply:",
          params: [{ name: "reply", type: T("@escaping (NSData?, error?) => void") }],
          returns: T("void"),
          async: { returns: T("NSData"), throws: true },
        },
        { name: "cancel", selector: "cancel", params: [], returns: T("void") },
      ],
      properties: [
        { name: "name", type: T("string"), getter: "getName", readonly: true },
        { name: "label", type: T("string?") },
      ],
    },
    {
      kind: "enum",
      name: "WDGStyle",
      native: "WDGStyle",
      cases: [{ name: "light", native: "WDGStyleLight", value: 0 }],
    },
  ],
  functions: [{ name: "WDGDistance", params: [], returns: T("double") }],
  constants: [{ name: "WDGVersion", type: T("string") }],
  skipped: ["WDGWidget.frame(_:): CGRect", "WDGWidget.origin(): pointer to double"],
});

describe("SDK coverage", () => {
  it("counts members as idiomatic (reached through a rule), raw, or unrepresentable (skipped)", () => {
    const c = coverage(widgets());
    // load (a promise), name (a getter as a property); init, cancel, label, WDGDistance, WDGVersion.
    expect(c).toMatchObject({
      module: "Widgets",
      idiomatic: 2,
      raw: 5,
      unrepresentable: 2,
      total: 9,
      reasons: { CGRect: 1, "pointer to double": 1 },
    });
  });

  it("tells members apart by stage: discovered, representable, generated, exercised", () => {
    const schema = widgets();
    schema.provenance = {
      artifact: "clang-module:Widgets",
      kind: "clang-module",
      target: "arm64-apple-ios15.1-simulator",
      extractor: "0",
    };
    const loader = schema.types[0]!;
    if (loader.kind === "class")
      loader.methods!.push({
        name: "attach",
        selector: "attach:",
        params: [{ name: "to", type: T("Widgets.WDGMissing") }],
        returns: T("void"),
        symbol: "objc:c:objc(cs)WDGLoader(im)attach:",
      });

    const key = (name: string) => symbolKey(sdkSymbols(schema).find((s) => s.name === name)!);
    const c = coverage(schema, undefined, {
      generated: new Set([key("load"), key("cancel"), key("WDGDistance")]),
      // Evidence for a member the app does not generate does not count.
      exercised: new Set([key("load"), key("label")]),
    });

    expect(c.stages).toEqual({ discovered: 10, representable: 7, generated: 3, exercised: 1 });
    expect(c.provenance).toMatchObject({ artifact: "clang-module:Widgets" });

    const member = (display: string) => c.members.find((m) => m.display === display);
    expect(member("WDGLoader.load")).toMatchObject({ stage: "exercised", key: key("load") });
    expect(member("WDGLoader.cancel")).toMatchObject({ stage: "generated" });
    expect(member("WDGLoader.label")).toMatchObject({ stage: "representable" });
    expect(member("WDGLoader.attach")).toEqual({
      key: key("attach"),
      display: "WDGLoader.attach",
      symbol: "objc:c:objc(cs)WDGLoader(im)attach:",
      artifact: "clang-module:Widgets",
      stage: "discovered",
      reason: "refers to Widgets.WDGMissing, which is not declared",
    });
    expect(member("WDGWidget.frame(_:)")).toEqual({
      display: "WDGWidget.frame(_:)",
      stage: "discovered",
      reason: "CGRect",
    });
  });

  it("leaves the stages it has no evidence for unknown", () => {
    expect(coverage(widgets()).stages).toEqual({
      discovered: 9,
      representable: 7,
      generated: null,
      exercised: null,
    });
  });
});

describe("a coverage summary", () => {
  const report = (
    module: string,
    total: number,
    unrepresentable: number,
    reasons: Record<string, number>,
  ) =>
    ({
      module,
      idiomatic: 0,
      raw: total - unrepresentable,
      unrepresentable,
      total,
      reasons,
      stages: {
        discovered: total,
        representable: total - unrepresentable,
        generated: null,
        exercised: null,
      },
      members: [],
    }) satisfies Coverage;

  it("totals the modules and ranks the reasons summed across them", () => {
    const summary = coverageSummary(
      [
        report("UIKit", 1000, 100, { "generic members": 60, "C unions": 40 }),
        report("android.os", 500, 50, { "generic members": 30, varargs: 20 }),
      ],
      2,
    );

    expect(summary).toBe(
      [
        "## SDK coverage",
        "",
        "2 modules: 1500 members, 1350 representable (90.0%), 150 unrepresentable (10.0%).",
        "",
        "| Members | Why they are unrepresentable (top 2 of 3) |",
        "| ---: | --- |",
        "| 90 | generic members |",
        "| 40 | C unions |",
        "",
      ].join("\n"),
    );
  });

  it("breaks ties by reason, so the summary is the same each run", () => {
    const summary = coverageSummary([report("A", 10, 4, { b: 2, a: 2 })]);

    expect(summary.indexOf("| 2 | a |")).toBeLessThan(summary.indexOf("| 2 | b |"));
    expect(summary).toContain("(top 2 of 2)");
  });

  it("escapes a reason's table characters", () => {
    expect(coverageSummary([report("A", 1, 1, { "a | b": 1 })])).toContain("| 1 | a \\| b |");
  });
});
