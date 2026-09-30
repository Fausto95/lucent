import { describe, expect, it } from "vite-plus/test";
import { argumentsShape, callForms, jsxForm } from "../src/call-form.ts";
import { parseSchemaType, type SdkParam } from "../src/schema.ts";

/** A parameter as a source module's schema has it: `label` (none: unlabeled), kind, default. */
function param(
  label: string | undefined,
  kind: "value" | "action" | "builder" = "value",
  defaulted?: "optional" | "omitted",
): SdkParam {
  return {
    name: label ?? "value",
    type: parseSchemaType(kind === "value" ? "double" : "() => void"),
    ...(defaulted ? { defaulted } : {}),
    swift: { ...(label ? { label } : {}), kind },
  };
}

/** The forms, each as its arguments: a positional index, the object's indexes, `trailing:i`; `?` optional. */
const written = (params: SdkParam[]) =>
  callForms(params).map((f) =>
    f.parts.map((p) => {
      const at =
        p.k === "labeled"
          ? `{${p.params.join(",")}}`
          : p.k === "trailing"
            ? `trailing:${p.param}`
            : `${p.param}`;
      return `${at}${p.optional ? "?" : ""}`;
    }),
  );

describe("the call form", () => {
  it("gives unlabeled arguments in order, labeled ones as one object, and a trailing closure last", () => {
    // VStack(alignment:spacing:content:): the object may be left out before the content.
    expect(
      written([
        param("alignment", "value", "optional"),
        param("spacing", "value", "optional"),
        param("content", "builder"),
      ]),
    ).toEqual([["trailing:2"], ["{0,1}", "trailing:2"]]);

    // animation(_:value:): the unlabeled animation first, then the object.
    expect(written([param(undefined), param("value")])).toEqual([["0", "{1}"]]);

    // Button(_:action:): a labeled closure last is the trailing one.
    expect(written([param(undefined), param("action", "action")])).toEqual([["0", "trailing:1"]]);
  });

  it("leaves out defaulted arguments where Swift may", () => {
    // frame(width:height:alignment:): every key of the object.
    expect(
      written([
        param("width", "value", "optional"),
        param("height", "value", "optional"),
        param("alignment", "value", "optional"),
      ]),
    ).toEqual([["{0,1,2}?"]]);

    // padding(_:_:): positional ones from the end.
    expect(
      written([param(undefined, "value", "optional"), param(undefined, "value", "optional")]),
    ).toEqual([["0?", "1?"]]);

    // withAnimation(_:_:): the animation before the required body, by a form of its own.
    expect(written([param(undefined, "value", "optional"), param(undefined, "action")])).toEqual([
      ["trailing:1"],
      ["0", "trailing:1"],
    ]);

    // onAppear(perform:): an optional trailing action.
    expect(written([param("perform", "action", "optional")])).toEqual([["trailing:0?"]]);
  });

  it("gives a positional default before a required positional one anyway", () => {
    expect(written([param(undefined, "value", "optional"), param(undefined)])).toEqual([
      ["0", "1"],
    ]);
  });

  it("never gives the parameters Lucent leaves out", () => {
    // Text(_:tableName:bundle:comment:): bundle and comment have no Lucent value.
    expect(
      written([
        param(undefined),
        param("tableName", "value", "optional"),
        param("bundle", "value", "omitted"),
        param("comment", "value", "omitted"),
      ]),
    ).toEqual([["0", "{1}?"]]);
  });
});

describe("the JSX form", () => {
  /** A parameter named `name`, of `type`. */
  const named = (
    name: string,
    type: string,
    label: string | undefined,
    kind: "value" | "action" | "builder" = "value",
    defaulted?: "optional",
  ): SdkParam => ({
    name,
    type: parseSchemaType(type),
    ...(defaulted ? { defaulted } : {}),
    swift: { ...(label ? { label } : {}), kind },
  });

  /** Each form's attributes (`name:param`, `?` optional) and children (`text:i`, `builder:i`). */
  const jsx = (params: SdkParam[]) =>
    callForms(params).map((f) => {
      const form = jsxForm(params, f);

      return [
        ...form.attributes.map((a) => `${a.name}:${a.param}${a.optional ? "?" : ""}`),
        ...(form.children
          ? [`${form.children.kind}:${form.children.param}${form.children.optional ? "?" : ""}`]
          : []),
      ];
    });

  it("names each argument an attribute by its label, a builder's content its children", () => {
    // VStack(alignment:spacing:content:)
    expect(
      jsx([
        named("alignment", "double", "alignment", "value", "optional"),
        named("spacing", "double", "spacing", "value", "optional"),
        named("content", "() => void", "content", "builder"),
      ]),
    ).toEqual([["builder:2"], ["alignment:0?", "spacing:1?", "builder:2"]]);

    // Button(action:label:): the action by its label, the label's content the children.
    expect(
      jsx([
        named("action", "() => void", "action", "action"),
        named("label", "() => void", "label", "builder"),
      ]),
    ).toEqual([["action:0", "builder:1"]]);
  });

  it("takes an unlabeled string as text children, where no builder takes them", () => {
    // Text(_ content:), Button(_ titleKey:action:), Toggle(_ titleKey:isOn:)
    expect(jsx([named("content", "string", undefined)])).toEqual([["text:0"]]);
    expect(
      jsx([
        named("titleKey", "string", undefined),
        named("action", "() => void", "action", "action"),
      ]),
    ).toEqual([["action:1", "text:0"]]);

    // Section(_ title:content:): the builder's content is the children, the title an attribute.
    expect(
      jsx([
        named("title", "string", undefined),
        named("content", "() => void", "content", "builder"),
      ]),
    ).toEqual([["title:0", "builder:1"]]);
  });

  it("names any other unlabeled argument by its Swift parameter", () => {
    // Image(systemName:) is labeled; Color(_ color:) and an unlabeled action are not.
    expect(jsx([named("systemName", "string", "systemName")])).toEqual([["systemName:0"]]);
    expect(jsx([named("color", "double", undefined)])).toEqual([["color:0"]]);
    expect(jsx([named("perform", "() => void", undefined, "action")])).toEqual([["perform:0"]]);
  });

  it("gives a modifier's arguments as none, one value, or a tuple", () => {
    const forms = (params: SdkParam[]) => callForms(params).map((f) => argumentsShape(f));

    expect(forms([])).toEqual(["none"]);
    expect(forms([named("length", "double", undefined)])).toEqual(["one"]);
    expect(forms([named("width", "double", "width"), named("height", "double", "height")])).toEqual(
      ["one"],
    );
    expect(
      forms([named("animation", "double", undefined), named("value", "double", "value")]),
    ).toEqual(["tuple"]);
  });
});
