import { describe, expect, it } from "vite-plus/test";
import { callForms } from "../src/call-form.ts";
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
