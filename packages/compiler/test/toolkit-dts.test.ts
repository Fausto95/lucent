import { describe, expect, it } from "vite-plus/test";
import { SCHEMA_FORMAT } from "@lucent-lang/bindgen";
import { parseSdkType, type SdkModuleSchema, type SdkParam } from "../src/sdk/schema.ts";
import { toolkitDts } from "../src/sdk/toolkit-dts.ts";
import { TOOLKITS } from "../src/ui/toolkits.ts";
import { auditTexts, tally } from "./dts-audit.ts";

const T = (s: string) => parseSdkType(s, "SwiftUI");

/** A type parameter a number, a string or a boolean may be (`V: Equatable`). */
const scalar = (name: string): SdkParam["type"] => ({
  k: "tparam",
  name,
  nullable: false,
  bound: T("Swift.Equatable"),
});

/** A parameter written as source: its label (none: unlabeled), kind and default. */
const param = (
  name: string,
  type: string,
  label: string | undefined,
  kind: "value" | "action" | "builder" = "value",
  defaulted?: "optional",
): SdkParam => ({
  name,
  type: T(type),
  ...(defaulted ? { defaulted } : {}),
  swift: { ...(label ? { label } : {}), kind },
});

/** SwiftUI in miniature, as bindgen reads a module written as source. */
const miniature = (): SdkModuleSchema => ({
  format: SCHEMA_FORMAT,
  platform: "ios",
  module: "SwiftUI",
  form: "source",
  types: [
    {
      kind: "class",
      name: "View",
      native: "SwiftUI.View",
      interface: true,
      swift: { kind: "protocol" },
      methods: [
        {
          name: "padding",
          symbol: "swift:padding",
          params: [param("length", "CGFloat", undefined)],
          returns: T("View"),
          swift: { name: "padding(_:)" },
        },
        {
          name: "onTapGesture",
          symbol: "swift:onTapGesture",
          params: [
            param("count", "NSInteger", "count", "value", "optional"),
            param("action", "@escaping () => void", "perform", "action"),
          ],
          returns: T("View"),
          swift: { name: "onTapGesture(count:perform:)" },
        },
        {
          name: "onLongPress",
          symbol: "swift:onLongPress",
          params: [param("action", "@escaping (double) => void", "perform", "action")],
          returns: T("View"),
          swift: { name: "onLongPress(perform:)" },
        },
        {
          name: "onChange",
          symbol: "swift:onChange17",
          params: [
            { ...param("value", "bool", "of"), type: scalar("V") },
            param("initial", "bool", "initial", "value", "optional"),
            {
              ...param("action", "bool", undefined, "action"),
              type: {
                k: "fn",
                params: [scalar("V"), scalar("V")],
                ret: T("void"),
                escaping: true,
                main: false,
                nullable: false,
              },
            },
          ],
          returns: T("View"),
          since: "17.0",
          swift: { name: "onChange(of:initial:_:)" },
        },
        {
          name: "onChange",
          symbol: "swift:onChange14",
          params: [
            { ...param("value", "bool", "of"), type: scalar("V") },
            {
              ...param("action", "bool", "perform", "action"),
              type: {
                k: "fn",
                params: [scalar("V")],
                ret: T("void"),
                escaping: true,
                main: false,
                nullable: false,
              },
            },
          ],
          returns: T("View"),
          since: "14.0",
          deprecated: true,
          swift: { name: "onChange(of:perform:)" },
        },
      ],
    },
    {
      kind: "class",
      name: "Picker",
      native: "SwiftUI.Picker",
      swift: { kind: "struct" },
      implements: ["SwiftUI.View"],
      constructors: [
        {
          symbol: "swift:Picker.init",
          params: [
            {
              ...param("selection", "bool", "selection"),
              type: {
                k: "ref",
                module: "SwiftUI",
                name: "Binding",
                nullable: false,
                args: [scalar("SelectionValue")],
              },
            },
            param("content", "() => SwiftUI.View", "content", "builder"),
          ],
          swift: { name: "init(selection:content:)" },
        },
      ],
    },
    {
      kind: "class",
      name: "VStack",
      native: "SwiftUI.VStack",
      swift: { kind: "struct" },
      implements: ["SwiftUI.View"],
      constructors: [
        {
          symbol: "swift:VStack.init",
          params: [
            param("spacing", "CGFloat?", "spacing", "value", "optional"),
            param("content", "() => SwiftUI.View", "content", "builder"),
          ],
          swift: { name: "init(spacing:content:)" },
        },
      ],
    },
    {
      kind: "class",
      name: "Edge",
      native: "SwiftUI.Edge",
      swift: { kind: "enum" },
      properties: [
        { name: "top", symbol: "swift:Edge.top", type: T("Edge"), static: true, readonly: true },
      ],
    },
    {
      kind: "class",
      name: "Labeled",
      native: "SwiftUI.Labeled",
      swift: { kind: "struct" },
      implements: ["SwiftUI.View"],
      constructors: [
        {
          symbol: "swift:Labeled.init",
          params: [
            param("title", "() => SwiftUI.View", "title", "builder"),
            param("icon", "() => SwiftUI.View", "icon", "builder"),
          ],
          swift: { name: "init(title:icon:)" },
        },
      ],
    },
    {
      kind: "class",
      name: "Repeat",
      native: "SwiftUI.Repeat",
      swift: { kind: "struct" },
      implements: ["SwiftUI.View"],
      constructors: [
        {
          symbol: "swift:Repeat.init",
          params: [
            param("count", "NSInteger", undefined),
            param("content", "(NSInteger) => SwiftUI.View", "content", "builder"),
          ],
          swift: { name: "init(_:content:)" },
        },
      ],
    },
    {
      kind: "class",
      name: "Binding",
      native: "SwiftUI.Binding",
      swift: { kind: "struct", propertyWrapper: true },
    },
    {
      kind: "class",
      name: "Slider",
      native: "SwiftUI.Slider",
      swift: { kind: "struct" },
      implements: ["SwiftUI.View"],
      constructors: [
        {
          symbol: "swift:Slider.init",
          params: [
            param("value", "SwiftUI.Binding<double>", "value"),
            param("bounds", "Swift.ClosedRange<double>", "in"),
            param("step", "double", "step", "value", "optional"),
          ],
          swift: { name: "init(value:in:step:)" },
        },
      ],
    },
    { kind: "class", name: "Font", native: "SwiftUI.Font", swift: { kind: "struct" } },
    {
      kind: "class",
      name: "Font_Weight",
      native: "SwiftUI.Font.Weight",
      swift: { kind: "struct" },
    },
    {
      kind: "class",
      name: "Edge_Set",
      native: "SwiftUI.Edge.Set",
      swift: { kind: "struct" },
      properties: [
        {
          name: "horizontal",
          symbol: "swift:Edge.Set.horizontal",
          type: T("Edge_Set"),
          static: true,
          readonly: true,
          since: "16.0",
        },
      ],
    },
  ],
});

const swiftui = () => toolkitDts(TOOLKITS.swiftui, miniature());

describe("a toolkit's declarations, from its source module", () => {
  it("declares its root, its body function and its content", () => {
    expect(swiftui()).toContain("export declare class UIHostingController {");
    expect(swiftui()).toContain(
      "export declare function swiftUI(body: () => View): UIHostingController;",
    );
    // A view, or nothing where a condition leaves it out (`shown && Text("a")`).
    expect(swiftui()).toContain(
      "export declare type Content = readonly (View | false | null | undefined)[];",
    );
  });

  it("declares a call of a type's name per call form, each leading back to its member", () => {
    const text = swiftui();

    expect(text).toContain("/** @swift swift:VStack.init 0 */\n  (content: Content): VStack;");
    expect(text).toContain(
      "/** @swift swift:VStack.init 1 */\n  (labeled: { spacing?: number | null }, content: Content): VStack;",
    );
    expect(text).toContain("export declare const VStack: $VStack;");
    expect(text).toContain(
      "/** @swift swift:onTapGesture 1 */\n  onTapGesture(labeled: { count?: number }, action: () => void): View;",
    );
  });

  it("types values nominally, and reaches nested types through their parent", () => {
    const text = swiftui();

    expect(text).toContain("export declare interface VStack extends View {");
    expect(text).toContain("readonly [toolkit]: { VStack: true; View: true };");
    expect(text).toContain("declare interface Edge_Set {");
    expect(text).toContain("readonly Set: $Edge_Set;");
    expect(text).toContain("export declare namespace Edge {\n  type Set = Edge_Set;\n}");
    expect(text).toMatch(/@since iOS 16\.0\n\s+\* @swift swift:Edge\.Set\.horizontal\n/);
    // Types without values of their own still name the types nested in them.
    expect(text).toContain("export declare namespace Font {\n  type Weight = Font_Weight;\n}");
    expect(text).toMatch(/export \{\};\n$/);
  });

  it("types a Binding of a number and a range with lucent:ui's forms", () => {
    const text = swiftui();

    expect(text).toContain('import type { Bound, ClosedRange } from "lucent:ui";');
    expect(text).toContain(
      "(labeled: { value: Bound<number>; in: ClosedRange<number>; step?: number }): Slider;",
    );
  });

  it("types a value of any scalar type with a type parameter, bound signals too", () => {
    const text = swiftui();

    expect(text).toContain(
      "onChange<V extends boolean | number | string>(labeled: { of: V; initial?: boolean }, action: (arg0: V, arg1: V) => void): View;",
    );
    expect(text).toContain(
      "<SelectionValue extends boolean | number | string>(labeled: { selection: Bound<SelectionValue> }, content: Content): Picker;",
    );
  });

  it("declares what a body writes on every supported iOS before what is deprecated", () => {
    const text = swiftui();

    expect(text.indexOf("@swift swift:onChange14")).toBeGreaterThan(-1);
    expect(text.indexOf("@swift swift:onChange14")).toBeLessThan(
      text.indexOf("@swift swift:onChange17"),
    );
  });

  it("takes each builder as content, the last one after the labeled arguments", () => {
    expect(swiftui()).toContain(
      "/** @swift swift:Labeled.init 0 */\n  (labeled: { title: Content }, icon: Content): Labeled;",
    );
  });

  it("declares what its plan refuses with the reason", () => {
    expect(swiftui()).toContain(
      "Lucent cannot write this in a body yet: `content` builds its content from values it is given: a body writes result builders that take none, for now.",
    );
  });

  it("type-checks", () => {
    expect(tally(auditTexts({ "toolkit/swiftui": swiftui() }))).toEqual({});
  });
});
