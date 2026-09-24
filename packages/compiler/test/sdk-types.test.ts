import { describe, expect, it } from "vite-plus/test";
import { sdkDts, stubDts } from "../src/sdk/dts.ts";
import { parseSdkType, type SdkModuleSchema } from "../src/sdk/schema.ts";

/**
 * A schema written with types in their written form (`string?`, `WDGLoader`),
 * as bindgen's objects: bare names refer to the schema's module.
 */
function typed(schema: { module: string } & Record<string, unknown>): SdkModuleSchema {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        (k === "type" || k === "returns") && typeof x === "string"
          ? parseSdkType(x, schema.module)
          : walk(x),
      ]),
    );
  };
  return walk(schema) as SdkModuleSchema;
}

describe("schema types", () => {
  it("parses the forms schemas use", () => {
    expect(parseSdkType("string?")).toEqual({ k: "string", nullable: true });
    expect(parseSdkType("Foundation.NSURL[]")).toEqual({
      k: "array",
      of: { k: "ref", module: "Foundation", name: "NSURL", nullable: false },
      nullable: false,
    });
    expect(parseSdkType("Record<id>?")).toEqual({
      k: "record",
      of: { k: "id", nullable: false },
      nullable: true,
    });
    expect(parseSdkType("Out<CFTypeRef>?")).toEqual({
      k: "out",
      of: { k: "id", nullable: false, cf: true },
      nullable: true,
    });
    expect(parseSdkType("Out<error>?")).toEqual({
      k: "out",
      of: { k: "error", nullable: false },
      nullable: true,
    });
    expect(parseSdkType("Widget", "com.example")).toEqual({
      k: "ref",
      module: "com.example",
      name: "Widget",
      nullable: false,
    });
    expect(parseSdkType("T[]", "", ["T"])).toEqual({
      k: "array",
      of: { k: "tparam", name: "T", nullable: false },
      nullable: false,
    });
    expect(parseSdkType("Set<UIKit.UITouch>?")).toEqual({
      k: "set",
      of: { k: "ref", module: "UIKit", name: "UITouch", nullable: false },
      nullable: true,
    });
  });

  it("parses blocks: parameters, result, whether they escape and run on the main thread", () => {
    const bool = { k: "prim", name: "bool", nullable: false };
    expect(parseSdkType("@escaping @main (bool, error?) => void")).toEqual({
      k: "fn",
      params: [bool, { k: "error", nullable: true }],
      ret: { k: "prim", name: "void", nullable: false },
      escaping: true,
      main: true,
      nullable: false,
    });
    expect(parseSdkType("(string) => bool")).toMatchObject({
      k: "fn",
      params: [{ k: "string" }],
      ret: bool,
      escaping: false,
      main: false,
    });
    // An optional block is stored, so it escapes.
    expect(parseSdkType("(@main (bool) => void)?")).toMatchObject({
      k: "fn",
      params: [bool],
      escaping: true,
      main: true,
      nullable: true,
    });
    expect(parseSdkType("@escaping ((string) => void, NSData?) => void")).toMatchObject({
      k: "fn",
      params: [
        { k: "fn", params: [{ k: "string" }] },
        { k: "bytes", nullable: true },
      ],
    });
  });
});

describe("SDK declarations", () => {
  const dts = sdkDts(
    typed({
      platform: "ios",
      module: "Widgets",
      types: [
        {
          kind: "class",
          name: "WDGLoader",
          native: "WDGLoader",
          methods: [
            {
              name: "observe",
              selector: "observeWithBlock:",
              params: [{ name: "block", type: "@escaping (string, NSInteger, id) => void" }],
              returns: "void",
            },
            {
              name: "load",
              selector: "loadWithReply:",
              params: [{ name: "reply", type: "@escaping (NSData?, error?) => void" }],
              returns: "void",
              async: { returns: "NSData", throws: true },
            },
            {
              name: "countWhere",
              selector: "countWhere:",
              params: [{ name: "predicate", type: "@main (string) => bool" }],
              returns: "NSInteger",
            },
            {
              name: "getItems",
              selector: "getItemsWithCompletionHandler:",
              params: [{ name: "completionHandler", type: "@escaping (string[]) => void" }],
              returns: "void",
              async: { returns: "string[]", name: "items" },
            },
          ],
        },
      ],
    }),
  );

  it("types blocks as functions of Lucent values", () => {
    expect(dts).toContain(
      "  observe(block: (arg0: string, arg1: number, arg2: NSObject) => void): void;",
    );
    expect(dts).toContain("  countWhere(predicate: (arg0: string) => boolean): number;");
  });

  it("declares protocols structurally, so Lucent classes implement them; optional requirements optional", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Widgets",
        types: [
          {
            kind: "class",
            name: "WDGLoaderDelegate",
            native: "WDGLoaderDelegate",
            interface: true,
            methods: [
              {
                name: "loader_didLoad",
                selector: "loader:didLoadData:",
                params: [
                  { name: "loader", type: "WDGLoader" },
                  { name: "data", type: "NSData" },
                ],
                returns: "void",
              },
              {
                name: "loaderShouldRetry",
                selector: "loaderShouldRetry:",
                params: [{ name: "loader", type: "WDGLoader" }],
                returns: "bool",
                optional: true,
              },
            ],
          },
          {
            kind: "class",
            name: "WDGLoader",
            native: "WDGLoader",
            implements: ["WDGLoaderDelegate"],
            properties: [
              { name: "delegate", type: "WDGLoaderDelegate?", setter: "setDelegate:", weak: true },
            ],
          },
        ],
      }),
    );
    // Abstract classes without a brand: structural, and they keep Java interfaces' constants.
    expect(d).toContain("export declare abstract class WDGLoaderDelegate {");
    expect(d).not.toContain("__lucent_WDGLoaderDelegate");
    expect(d).toContain("  loader_didLoad(loader: WDGLoader, data: Uint8Array): void;");
    expect(d).toContain("  loaderShouldRetry?(loader: WDGLoader): boolean;");
    expect(d).toContain("export declare interface WDGLoader extends WDGLoaderDelegate {}");
    expect(d).toContain("  delegate: WDGLoaderDelegate | null;");
  });

  it("re-exports the implementation modules it uses, as module maps' export * does", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "CoreLocation",
        types: [
          {
            kind: "class",
            name: "CLLocationManager",
            native: "CLLocationManager",
            properties: [
              { name: "location", type: "_LocationEssentials.CLLocation?", readonly: true },
            ],
          },
        ],
      }),
    );
    expect(d).toContain('import type { CLLocation } from "lucent:ios/_LocationEssentials";');
    expect(d).toContain('export * from "lucent:ios/_LocationEssentials";');
  });

  it("lets functions stand for Java interfaces with one abstract method", () => {
    const d = sdkDts(
      typed({
        platform: "android",
        module: "com.example.widgets",
        types: [
          {
            kind: "class",
            name: "OnEvent",
            native: "com/example/widgets/OnEvent",
            interface: true,
            functional: "onEvent",
            methods: [
              {
                name: "onEvent",
                params: [
                  { name: "arg0", type: "string" },
                  { name: "arg1", type: "int" },
                ],
                returns: "void",
                abstract: true,
              },
            ],
          },
          {
            kind: "class",
            name: "Widget",
            native: "com/example/widgets/Widget",
            methods: [
              { name: "setOnEvent", params: [{ name: "arg0", type: "OnEvent?" }], returns: "void" },
            ],
          },
        ],
      }),
    );
    expect(d).toContain(
      "  setOnEvent(arg0: OnEvent | ((arg0: string, arg1: number) => void) | null): void;",
    );
  });

  it("declares C structs as object types", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Widgets",
        types: [
          {
            kind: "struct",
            name: "WDGPoint",
            native: "WDGPoint",
            fields: [
              { name: "x", type: "double" },
              { name: "y", type: "double" },
            ],
          },
          {
            kind: "struct",
            name: "WDGCircle",
            native: "WDGCircle",
            fields: [
              { name: "center", type: "WDGPoint" },
              { name: "radius", type: "double" },
            ],
          },
        ],
      }),
    );
    expect(d).toContain("export declare type WDGPoint = { x: number; y: number };");
    expect(d).toContain("export declare type WDGCircle = { center: WDGPoint; radius: number };");
  });

  it("adds a promise overload for completion handlers Swift imports as async", () => {
    expect(dts).toContain(
      "  load(reply: (arg0: Uint8Array | null, arg1: Error | null) => void): void;",
    );
    expect(dts).toContain("  load(): Promise<Uint8Array>;");
    // Under the name Swift gives the async form.
    expect(dts).toContain("  getItems(completionHandler: (arg0: string[]) => void): void;");
    expect(dts).toContain("  items(): Promise<string[]>;");
  });
});

describe("names-only declarations", () => {
  it("do not depend on the symbol graph's order, which changes between extractions", () => {
    const types = (order: string[]) =>
      Object.fromEntries(order.map((n) => [n, { kind: "class" as const, native: n }]));
    const a = stubDts("ios", "Kit", {
      module: "Kit",
      refs: {},
      aliases: {},
      types: types(["KBeta", "KAlpha"]),
    });
    const b = stubDts("ios", "Kit", {
      module: "Kit",
      refs: {},
      aliases: {},
      types: types(["KAlpha", "KBeta"]),
    });
    expect(a).toBe(b);
    expect(a.indexOf("KAlpha")).toBeLessThan(a.indexOf("KBeta"));
  });

  it("declare structs' fields, so values of them can be written", () => {
    const d = stubDts("ios", "Kit", {
      module: "Kit",
      refs: {},
      aliases: {},
      types: {
        KPoint: {
          kind: "struct",
          native: "KPoint",
          fields: [
            { name: "x", type: parseSdkType("double") },
            { name: "y", type: parseSdkType("double") },
          ],
        },
        KRect: {
          kind: "struct",
          native: "KRect",
          fields: [
            { name: "origin", type: parseSdkType("Kit.KPoint") },
            { name: "edge", type: parseSdkType("Kit.KEdge") },
          ],
        },
        KEdge: { kind: "enum", native: "KEdge" },
      },
    });
    expect(d).toContain("export declare type KPoint = { x: number; y: number };");
    expect(d).toContain("export declare type KRect = { origin: KPoint; edge: KEdge };");
  });
});
