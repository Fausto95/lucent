import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import { ownTypes, planBinding, unsupportedReason } from "../src/binding-plan.ts";
import { coverage } from "../src/coverage.ts";
import { symbolGraph } from "../src/ios.ts";
import { sdkSourceModule } from "../src/provider.ts";
import type {
  SdkCallable,
  SdkClassSchema,
  SdkMethodSchema,
  SdkModuleSchema,
  SdkPropertySchema,
} from "../src/schema.ts";
import { buildSourceSchema } from "../src/swift-source.ts";
import { swiftModule } from "./swift-module.ts";

const xcode =
  process.platform === "darwin" &&
  spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).status === 0;

/** Scenery (a SwiftUI in miniature) read as a module written as source. */
function scenery(): SdkModuleSchema {
  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  const dir = swiftModule("Scenery");

  return buildSourceSchema("Scenery", [
    symbolGraph("Scenery", { modules: ["Scenery"], includePaths: [dir] }, sdk),
  ]);
}

type Member = SdkCallable | SdkMethodSchema | SdkPropertySchema;

/** A member by its Swift name (`init(alignment:spacing:content:)`), on `type` or at the top level. */
function lookup(schema: SdkModuleSchema, type: string | undefined, swift: string) {
  const owner = type
    ? (schema.types.find((t) => t.name === type) as SdkClassSchema | undefined)
    : undefined;
  const members: Member[] = owner
    ? [...(owner.constructors ?? []), ...(owner.methods ?? []), ...(owner.properties ?? [])]
    : (schema.functions ?? []);
  const member = members.find((m) => m.swift?.name === swift);
  if (!member) throw new Error(`no ${type ?? "function"} ${swift}`);

  return { owner, member };
}

/** How the call writes each parameter: `label:kind`, `_` unlabeled, `?` defaulted, `-` never given. */
function facts(member: Member): string[] {
  if (!("params" in member)) return [];

  return member.params.map(
    (p) =>
      `${p.swift?.label ?? "_"}:${p.swift?.kind}${p.defaulted === "optional" ? "?" : p.defaulted === "omitted" ? "-" : ""}`,
  );
}

describe.skipIf(!xcode)("a Swift module written as source", () => {
  const schema = xcode ? scenery() : ({} as SdkModuleSchema);
  const at = (type: string | undefined, swift: string) => lookup(schema, type, swift).member;
  const refusal = (type: string | undefined, swift: string) => {
    const { owner, member } = lookup(schema, type, swift);
    return unsupportedReason(planBinding(owner, member, schema, ownTypes(schema)));
  };

  it("is a source module", () => {
    expect(schema.form).toBe("source");
  });

  it("records each parameter's label, place and kind, and its default", () => {
    // A trailing @ViewBuilder (through a typealias of the builder) is content.
    expect(facts(at("VStack", "init(alignment:spacing:content:)"))).toEqual([
      "alignment:value?",
      "spacing:value?",
      "content:builder",
    ]);
    // An unlabeled value, and a labeled closure: an action.
    expect(facts(at("Button", "init(_:action:)"))).toEqual(["_:value", "action:action"]);
    expect(facts(at("Button", "init(action:label:)"))).toEqual(["action:action", "label:builder"]);
    // View's modifiers: its protocol extension's methods.
    expect(facts(at("View", "padding(_:)"))).toEqual(["_:value"]);
    expect(facts(at("View", "padding(_:_:)"))).toEqual(["_:value?", "_:value?"]);
    expect(facts(at("View", "frame(width:height:alignment:)"))).toEqual([
      "width:value?",
      "height:value?",
      "alignment:value?",
    ]);
    expect(facts(at("View", "onTapGesture(count:perform:)"))).toEqual([
      "count:value?",
      "perform:action",
    ]);
    // A default of a type the body cannot write is never given.
    expect(facts(at("Text", "init(_:comment:)"))).toEqual(["_:value", "comment:value-"]);
    expect(facts(at(undefined, "withAnimation(_:_:)"))).toEqual(["_:value?", "_:action"]);
    // A closure returning a value, with a default, is never given.
    expect(facts(at("View", "marked(_:mark:)"))).toEqual(["_:value", "mark:action-"]);
  });

  it("types parameters by what their constraints say", () => {
    const params = (m: Member) => ("params" in m ? m.params.map((p) => p.type) : []);

    // A protocol of the module, a standard protocol's Lucent values, a string literal's type.
    expect(params(at("View", "foregroundStyle(_:)"))[0]).toMatchObject({
      k: "ref",
      name: "ShapeStyle",
    });
    // A standard protocol's Lucent values (Equatable: a number, a string or a boolean) are its
    // type parameter's, each use of it the same one.
    const equatable = {
      k: "tparam",
      name: "V",
      bound: { k: "ref", module: "Swift", name: "Equatable" },
    };
    expect(params(at("View", "animation(_:value:)"))[1]).toMatchObject(equatable);
    expect(params(at("View", "onChange(of:initial:_:)"))).toMatchObject([
      equatable,
      { k: "prim", name: "bool" },
      { k: "fn", params: [equatable, equatable] },
    ]);
    expect(params(at("Choice", "init(selection:content:)"))[0]).toMatchObject({
      k: "ref",
      name: "Binding",
      args: [
        {
          k: "tparam",
          name: "SelectionValue",
          bound: { k: "ref", module: "Swift", name: "Hashable" },
        },
      ],
    });
    expect(params(at("Text", "init(_:comment:)"))[0]).toMatchObject({ k: "string" });
    expect(params(at("Text", "init(_:)"))[0]).toMatchObject({ k: "string" });
    // The content a builder makes, and what withAnimation's body gives back: nothing to write.
    expect(params(at("VStack", "init(alignment:spacing:content:)"))[2]).toMatchObject({
      k: "fn",
      ret: { k: "ref", name: "View" },
    });
    expect((at(undefined, "withAnimation(_:_:)") as SdkMethodSchema).returns).toMatchObject({
      k: "prim",
      name: "void",
    });
    // `some View` results are Views; a type's own members give it back.
    expect((at("View", "padding(_:)") as SdkMethodSchema).returns).toMatchObject({ name: "View" });
    expect((at("Text", "bold()") as SdkMethodSchema).returns).toMatchObject({ name: "Text" });
  });

  it("types numbers of any floating-point or striding type as Lucent numbers, and their ranges", () => {
    const params = (m: Member) => ("params" in m ? m.params.map((p) => p.type) : []);
    const double = { k: "prim", name: "double", nullable: false };
    const range = { k: "ref", module: "Swift", name: "ClosedRange", args: [double] };

    // V: BinaryFloatingPoint (and V.Stride's) is a Double: the Binding a number signal gives.
    expect(params(at("Slider", "init(value:in:step:label:onEditingChanged:)"))).toMatchObject([
      { k: "ref", name: "Binding", args: [double] },
      range,
      double,
      { k: "fn" },
      { k: "fn" },
    ]);
    expect(params(at("Slider", "init(value:in:onEditingChanged:)"))[1]).toMatchObject(range);
    // V: Strideable, and a value of V that may be nil.
    expect(params(at("Stepper", "init(value:in:step:label:)"))).toMatchObject([
      { k: "ref", name: "Binding", args: [double] },
      range,
      double,
      { k: "fn" },
    ]);
    expect(params(at("Meter", "init(value:total:)"))).toMatchObject([
      { ...double, nullable: true },
      double,
    ]);
  });

  it("makes values of statics and enum cases, and types of structs, enums and protocols", () => {
    expect(at("Color", "green")).toMatchObject({ static: true, type: { name: "Color" } });
    expect(at("Edge", "top")).toMatchObject({ static: true, type: { name: "Edge" } });
    expect(at("Edge_Set", "horizontal")).toMatchObject({
      static: true,
      type: { name: "Edge_Set" },
    });
    expect((schema.types.find((t) => t.name === "Color") as SdkClassSchema).implements).toEqual([
      "Scenery.ShapeStyle",
      "Scenery.View",
    ]);
    expect(schema.types.find((t) => t.name === "Shape")).toMatchObject({
      interface: true,
      implements: ["Scenery.View"],
    });
    // A class is an object, not a value a body writes.
    expect(schema.types.find((t) => t.name === "Host")).toBeUndefined();
  });

  it("records where members are available", () => {
    expect(at("View", "glow(_:)").since).toBe("17.0");
    expect(at("View", "padding(_:)").since).toBeUndefined();
  });

  it("skips what it cannot write, with the reason", () => {
    expect(schema.skipped).toEqual(
      expect.arrayContaining([
        "Animation.easeInOut: named like its type's method easeInOut(…), which takes arguments",
        "Shape.path(in:): a protocol requirement: its types implement it, a body does not call it",
        "View.sized(_:): CGSize",
        "View.onDropped(perform:): `perform` returns a value (bool) to SwiftUI: a body's callbacks call the setup, which returns them nothing",
        "View.tinted(_:): generic constraints the call form cannot write yet (S: ShapeStyle & View)",
      ]),
    );
  });

  it("refuses by plan what the call form cannot write yet", () => {
    // A Binding of a Bool is a setup signal, which bind(signal) gives.
    expect(refusal("Toggle", "init(isOn:label:)")).toBeUndefined();
    // So is a Binding of a type parameter a number, a string or a boolean may be.
    expect(refusal("Choice", "init(selection:content:)")).toBeUndefined();
    // So is a Binding of a number, whatever floating-point or striding type Swift makes it.
    expect(refusal("Slider", "init(value:in:onEditingChanged:)")).toBeUndefined();
    expect(refusal("Stepper", "init(value:in:step:label:)")).toBeUndefined();
    expect(refusal("Meter", "init(value:total:)")).toBeUndefined();
    // A Binding of anything else says what it is of.
    expect(refusal("Swatch", "init(selection:)")).toBe(
      "`selection` takes a Binding of Color (state the body shares): bind(signal) gives Bindings of a Bool, a String, a number, or a type any of them may be",
    );
    expect(refusal("ForEach", "init(_:content:)")).toBe(
      "`content` builds its content from values it is given: a body writes result builders that take none, for now",
    );
    // Builders are closures wherever they are given: labeled, or before an action.
    expect(refusal("Labeled", "init(title:icon:)")).toBeUndefined();
    expect(refusal("Slider", "init(value:in:step:label:onEditingChanged:)")).toBeUndefined();
    // An action's arguments cross back into Lucent.
    expect(refusal("View", "onLongPress(perform:)")).toBeUndefined();
    expect(refusal("VStack", "init(alignment:spacing:content:)")).toBeUndefined();
    expect(refusal(undefined, "withAnimation(_:_:)")).toBeUndefined();

    const plan = planBinding(
      lookup(schema, "View", "padding(_:)").owner,
      at("View", "padding(_:)"),
      schema,
      ownTypes(schema),
    );
    expect(plan.backend).toBe("swift-source");
  });

  it("counts what it writes and what it refuses, by reason", () => {
    const c = coverage(schema);

    expect(c.reasons).toMatchObject({
      "generic constraints the call form cannot write yet (S: ShapeStyle & View)": 1,
    });
    expect(Object.keys(c.reasons).some((r) => r.startsWith("result builders"))).toBe(false);
    expect(c.raw).toBeGreaterThan(20);
  });
});

describe.skipIf(!xcode)("SwiftUI written as source", () => {
  const found = xcode ? sdkSourceModule("ios", "SwiftUI") : { missing: "no Xcode" };
  const schema = "schema" in found ? found.schema : ({} as SdkModuleSchema);
  const at = (type: string | undefined, swift: string) => lookup(schema, type, swift).member;

  it("is SwiftUI's own declarations, SwiftUICore's included", () => {
    expect(found).toHaveProperty("schema");
    expect(schema.provenance).toMatchObject({ kind: "sdk" });
    // VStack is declared in SwiftUICore, which SwiftUI re-exports as its own.
    expect(facts(at("VStack", "init(alignment:spacing:content:)"))).toEqual([
      "alignment:value?",
      "spacing:value?",
      "content:builder",
    ]);
    expect(facts(at("Button", "init(_:action:)"))).toEqual(["_:value", "action:action"]);
    expect(facts(at("View", "onTapGesture(count:perform:)"))).toEqual([
      "count:value?",
      "perform:action",
    ]);
    expect(facts(at("View", "animation(_:value:)"))).toEqual(["_:value", "value:value"]);
    expect(facts(at("Shape", "fill(_:style:)"))).toEqual(["_:value", "style:value?"]);
    expect(facts(at(undefined, "withAnimation(_:_:)"))).toEqual(["_:value?", "_:action"]);
    expect(at("Animation", "spring(response:dampingFraction:blendDuration:)")).toMatchObject({
      static: true,
    });
    expect(at("Color", "green")).toMatchObject({ static: true });
  }, 300_000);

  it("refuses bindings, builders given values and generic constraints, with the reasons", () => {
    const c = coverage(schema);

    // Each generic constraint the call form cannot write says what it is.
    expect(Object.keys(c.reasons)).toEqual(
      expect.arrayContaining([
        "generic constraints the call form cannot write yet (F: ParseableFormatStyle)",
      ]),
    );
    expect(Object.keys(c.reasons).some((r) => r.includes("bind(signal)"))).toBe(true);
    expect(Object.keys(c.reasons).some((r) => r.includes("from values it is given"))).toBe(true);
    expect(c.raw).toBeGreaterThan(1000);
  }, 300_000);
});
