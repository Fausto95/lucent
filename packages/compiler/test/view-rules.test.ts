/**
 * What a native view class takes in JSX, derived by rule from its schema
 * (T48): no view, prop or event is named in Lucent, so the classes here are
 * named at random on every run.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { SCHEMA_FORMAT } from "@lucent-lang/bindgen";
import { parseSdkType, type SdkClassSchema, type SdkModuleSchema } from "../src/sdk/schema.ts";
import { viewConstruction, viewRules } from "../src/sdk/view-rules.ts";

/** A name nothing in Lucent can know. */
const P = `Z${crypto
  .randomBytes(3)
  .toString("hex")
  .replace(/\d/g, (d) => "QRSTUVWXYZ"[+d]!)
  .toUpperCase()}`;

/** A schema written with types in their written form (`string?`, `Foo`): bare names are the module's. */
function schema(
  platform: "ios" | "android",
  module: string,
  types: Record<string, unknown>[],
): SdkModuleSchema {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        (k === "type" || k === "returns") && typeof x === "string"
          ? parseSdkType(x, module)
          : walk(x),
      ]),
    );
  };

  return {
    format: SCHEMA_FORMAT,
    platform,
    module,
    provenance: { artifact: `pod:${P}Kit@1.0.0`, kind: "framework", target: "x", extractor: "x" },
    types: walk(types) as SdkModuleSchema["types"],
  };
}

const classOf = (s: SdkModuleSchema, name: string) =>
  s.types.find((t): t is SdkClassSchema => t.kind === "class" && t.name === name)!;

/** A module's types by reference, as the rules look other classes and enums up. */
const finder =
  (...modules: SdkModuleSchema[]) =>
  (module: string, name: string) =>
    modules.find((m) => m.module === module)?.types.find((t) => t.name === name);

describe("view rules on iOS", () => {
  const kit = schema("ios", `${P}Kit`, [
    {
      kind: "class",
      name: `${P}Base`,
      native: `${P}Base`,
      extends: "UIKit.UIView",
      constructors: [
        { selector: "init", params: [] },
        { selector: "initWithFrame:", params: [{ name: "frame", type: "CoreGraphics.CGRect" }] },
      ],
    },
    {
      kind: "class",
      name: `${P}Gauge`,
      native: `${P}Gauge`,
      extends: `${P}Base`,
      inheritsInit: true,
      properties: [
        { name: "level", type: "double", setter: "setLevel:" },
        { name: "caption", type: "string?", setter: "setCaption:" },
        { name: "turns", type: "int", readonly: true },
        { name: "shared", type: "double", static: true, setter: "setShared:" },
        {
          name: "onTurn",
          type: {
            k: "fn",
            params: [{ k: "prim", name: "double", nullable: false }],
            ret: { k: "prim", name: "void", nullable: false },
            nullable: true,
          },
          setter: "setOnTurn:",
        },
      ],
      methods: [
        {
          name: "addAction",
          selector: "addAction:forControlEvents:",
          params: [
            { name: "action", type: `${P}Action` },
            { name: "events", type: `${P}Event` },
          ],
          returns: "void",
        },
        { name: "layoutSubviews", selector: "layoutSubviews", params: [], returns: "void" },
        {
          name: "insertDial",
          selector: "insertDial:atIndex:",
          params: [
            { name: "dial", type: "UIKit.UIView" },
            { name: "index", type: "long" },
          ],
          returns: "void",
        },
      ],
    },
    { kind: "class", name: `${P}Action`, native: `${P}Action` },
    {
      kind: "enum",
      name: `${P}Event`,
      native: `${P}Events`,
      options: true,
      cases: [
        { name: "touchUpInside", native: "TouchUpInside", value: 64 },
        { name: "valueChanged", native: "ValueChanged", value: 4096 },
        { name: "allTouchEvents", native: "AllTouchEvents", value: 4095 },
      ],
    },
  ]);
  const find = finder(kit);

  it("takes its writable properties, a block property among them, and not methods", () => {
    const rules = viewRules(classOf(kit, `${P}Gauge`), kit, find);

    expect(rules.props.map((p) => p.name)).toEqual(["level", "caption", "onTurn"]);
    expect(rules.props[0]).toMatchObject({
      kind: "property",
      explanation: expect.stringContaining(`${P}Gauge.level`),
    });
  });

  it("gives each single-bit case of its control events an event, with the control as sender", () => {
    const rules = viewRules(classOf(kit, `${P}Gauge`), kit, find);

    expect(rules.events.map((e) => e.name)).toEqual(["onTouchUpInside", "onValueChanged"]);
    expect(rules.events[0]).toMatchObject({
      kind: "control",
      value: 64,
      explanation: expect.stringContaining(`addAction:forControlEvents:`),
    });
  });

  it("takes children through the method its declarations insert them at an index with", () => {
    expect(viewRules(classOf(kit, `${P}Gauge`), kit, find).children).toMatchObject({
      insert: { selector: "insertDial:atIndex:" },
      explanation: expect.stringContaining(`${P}Gauge.insertDial:atIndex:`),
    });
    expect(viewRules(classOf(kit, `${P}Base`), kit, find).children).toBeUndefined();
  });

  it("is made with a zero frame, through the initializer its superclass declares", () => {
    expect(viewConstruction(classOf(kit, `${P}Gauge`), kit, find)).toMatchObject({
      kind: "frame",
      owner: `${P}Base`,
    });
  });
});

describe("view rules on Android", () => {
  const pkg = `dev.${P.toLowerCase()}.views`;
  const views = schema("android", pkg, [
    {
      kind: "class",
      name: `${P}Dial`,
      native: `dev/${P.toLowerCase()}/views/${P}Dial`,
      extends: "android.view.View",
      constructors: [{ params: [{ name: "context", type: "android.content.Context?" }] }],
      methods: [
        { name: "setText", params: [{ name: "text", type: "string?" }], returns: "void" },
        { name: "setText", params: [{ name: "id", type: "int" }], returns: "void" },
        { name: "setLevel", params: [{ name: "level", type: "double" }], returns: "void" },
        {
          name: "setModel",
          typeParams: ["T"],
          params: [{ name: "model", type: { k: "tparam", name: "T", nullable: true } }],
          returns: "void",
        },
        {
          name: "setRange",
          params: [
            { name: "a", type: "int" },
            { name: "b", type: "int" },
          ],
          returns: "void",
        },
        {
          name: "setOnTurnListener",
          params: [{ name: "l", type: `${P}Dial_OnTurnListener?` }],
          returns: "void",
        },
        {
          name: "setOnDragListener",
          params: [{ name: "l", type: `${P}Dial_OnDragListener?` }],
          returns: "void",
        },
        { name: "getLevel", params: [], returns: "double" },
        {
          name: "addView",
          params: [
            { name: "child", type: "android.view.View?" },
            { name: "index", type: "int" },
          ],
          returns: "void",
        },
      ],
    },
    {
      kind: "class",
      name: `${P}Dial_OnTurnListener`,
      native: `dev/${P.toLowerCase()}/views/${P}Dial$OnTurnListener`,
      interface: true,
      functional: "onTurn",
      methods: [
        {
          name: "onTurn",
          abstract: true,
          params: [{ name: "level", type: "double" }],
          returns: "void",
        },
      ],
    },
    {
      kind: "class",
      name: `${P}Dial_OnDragListener`,
      native: `dev/${P.toLowerCase()}/views/${P}Dial$OnDragListener`,
      interface: true,
      methods: [
        { name: "onStart", abstract: true, params: [], returns: "void" },
        { name: "onStop", abstract: true, params: [], returns: "void" },
      ],
    },
  ]);
  const find = finder(views);

  it("takes its one-value setters as props, overloads together", () => {
    const rules = viewRules(classOf(views, `${P}Dial`), views, find);

    expect(rules.props.map((p) => p.name)).toEqual(["text", "level"]);
    expect(rules.props[0]).toMatchObject({ kind: "setter", overloads: [{}, {}] });
  });

  it("derives an event from a listener setter of a one-method interface, and explains the other", () => {
    const rules = viewRules(classOf(views, `${P}Dial`), views, find);

    expect(rules.events).toEqual([
      expect.objectContaining({
        kind: "listener",
        name: "onTurn",
        method: expect.objectContaining({ name: "onTurn" }),
      }),
    ]);
    expect(rules.refused).toEqual([
      { name: "onDrag", reason: expect.stringMatching(/more than one method/) },
      { name: "model", reason: expect.stringMatching(/generic/) },
    ]);
  });

  it("takes children through addView(View, int)", () => {
    expect(viewRules(classOf(views, `${P}Dial`), views, find).children).toMatchObject({
      insert: { name: "addView" },
    });
  });

  it("is made with the host's context", () => {
    expect(viewConstruction(classOf(views, `${P}Dial`), views, find)).toMatchObject({
      kind: "context",
    });
  });
});
