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

describe("names-only declarations", () => {
  it("declare a generic type's type parameters, so references can pass type arguments", () => {
    const dts = stubDts("ios", "Media", {
      module: "Media",
      refs: {},
      aliases: {},
      types: {
        ReadyBuffer: { kind: "class", native: "Media.ReadyBuffer", swift: true, typeParams: 2 },
        Plain: { kind: "class", native: "MDPlain" },
      },
    });

    expect(dts).toContain("class ReadyBuffer<T0 = unknown, T1 = unknown>");
    expect(dts).toMatch(/class Plain extends NSObject/);
  });
});

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
      "  observe(block: (arg0: string, arg1: bigint, arg2: NSObject) => void): void;",
    );
    expect(dts).toContain("  countWhere(predicate: (arg0: string) => boolean): bigint;");
  });

  it("types native 64-bit integers as bigints, a constant group's as numbers", () => {
    const long = parseSdkType("long");
    const grouped = { ...long, group: true as const };
    const windows = ["com.example.clock.Clock.WINDOW_SHORT", "com.example.clock.Clock.WINDOW_LONG"];

    const d = sdkDts(
      typed({
        platform: "android",
        module: "com.example.clock",
        types: [
          {
            kind: "class",
            name: "Clock",
            native: "com/example/clock/Clock",
            properties: [
              {
                name: "NEVER",
                static: true,
                readonly: true,
                type: long,
                value: "9223372036854775807",
              },
              { name: "WINDOW_SHORT", static: true, readonly: true, type: grouped, value: 1 },
              { name: "WINDOW_LONG", static: true, readonly: true, type: grouped, value: 60000 },
            ],
            methods: [
              { name: "elapsed", params: [], returns: "long", static: true },
              {
                name: "sleep",
                params: [{ name: "ms", type: "long" }],
                returns: "void",
                static: true,
              },
              {
                name: "setWindow",
                params: [{ name: "window", type: grouped, oneOf: windows }],
                returns: "void",
              },
              { name: "times", params: [], returns: "long[]" },
            ],
          },
        ],
      }),
    );

    expect(d).toContain("  static readonly NEVER: 9223372036854775807n;");
    expect(d).toContain("  static readonly WINDOW_LONG: 60000;");
    expect(d).toContain("  static elapsed(): bigint;");
    expect(d).toContain("  static sleep(ms: bigint): void;");
    expect(d).toContain("  setWindow(window: number): void;");
    expect(d).toContain("  times(): bigint[];");
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

  it("imports a class named as one of its own, or as another module's, under an alias", () => {
    const d = sdkDts(
      typed({
        platform: "android",
        module: "androidx.credentials",
        types: [
          {
            kind: "class",
            name: "CredentialOption",
            native: "androidx/credentials/CredentialOption",
          },
          {
            kind: "class",
            name: "Bridge",
            native: "androidx/credentials/Bridge",
            methods: [
              {
                name: "convert",
                params: [
                  { name: "own", type: "CredentialOption" },
                  { name: "framework", type: "android.credentials.CredentialOption" },
                  { name: "first", type: "android.os.Bundle" },
                  { name: "second", type: "com.example.Bundle" },
                ],
                returns: "android.credentials.CredentialOption[]",
                static: true,
              },
            ],
          },
        ],
      }),
    );

    expect(d).toContain(
      'import type { CredentialOption as android_credentials_CredentialOption } from "lucent:android/android.credentials";',
    );
    expect(d).toContain(
      'import type { Bundle as android_os_Bundle } from "lucent:android/android.os";',
    );
    expect(d).toContain(
      'import type { Bundle as com_example_Bundle } from "lucent:android/com.example";',
    );
    expect(d).toContain(
      "  static convert(own: CredentialOption, framework: android_credentials_CredentialOption, first: android_os_Bundle, second: com_example_Bundle): android_credentials_CredentialOption[];",
    );
  });

  it("declares java.lang.AutoCloseable disposable, for using declarations", () => {
    const d = sdkDts(
      typed({
        platform: "android",
        module: "java.lang",
        types: [
          {
            kind: "class",
            name: "AutoCloseable",
            native: "java/lang/AutoCloseable",
            interface: true,
            methods: [{ name: "close", params: [], returns: "void", abstract: true }],
          },
        ],
      }),
    );
    expect(d).toContain("  [Symbol.dispose](): void;");
  });

  it("documents main-only and blocking members", () => {
    const d = sdkDts(
      typed({
        platform: "android",
        module: "com.example.widgets",
        types: [
          {
            kind: "class",
            name: "Widget",
            native: "com/example/widgets/Widget",
            methods: [
              { name: "draw", params: [], returns: "void", mainActor: true },
              { name: "load", params: [], returns: "void", worker: true, since: 30 },
            ],
          },
        ],
      }),
    );
    expect(d).toContain(
      "  /**\n   * Main thread only: call it inside `main(() => …)`.\n   * Native: com.example.widgets.Widget#draw()V, in com.example.widgets.\n   */\n  draw(): void;",
    );
    expect(d).toContain(
      "  /**\n   * Since API 30. Blocks (@WorkerThread): call it outside `main(() => …)`.\n   * Native: com.example.widgets.Widget#load()V, in com.example.widgets.\n   */\n  load(): void;",
    );
  });

  it("documents each interface in the language that declares it", () => {
    const header = (platform: "ios" | "android", facts: Record<string, unknown>) =>
      sdkDts(
        typed({
          platform,
          module: "Kit",
          types: [
            { kind: "class", name: "Listener", native: "Kit/Listener", interface: true, ...facts },
          ],
        }),
      );

    expect(header("ios", {})).toContain(" * An Objective-C protocol.");
    expect(header("ios", {})).not.toContain("A Java interface.");
    expect(header("ios", { swift: { kind: "protocol" } })).toContain(" * A Swift protocol.");
    expect(header("android", {})).toContain(" * A Java interface.");
    expect(header("android", { kotlin: { kind: "interface" } })).toContain(
      " * A Kotlin interface.",
    );
  });

  it("documents Swift async members of the main actor as callable from any thread, as the compiler checks them", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Kit",
        types: [
          {
            kind: "class",
            name: "Store",
            native: "Kit.Store",
            swift: { kind: "struct" },
            methods: [
              {
                name: "refund",
                params: [],
                returns: "void",
                static: true,
                mainActor: true,
                swift: { name: "refund()", async: true },
              },
              {
                name: "review",
                params: [],
                returns: "void",
                static: true,
                mainActor: true,
                swift: { name: "review()" },
              },
            ],
          },
          {
            kind: "class",
            name: "Screen",
            native: "Kit.Screen",
            mainActor: true,
            swift: { kind: "class" },
            methods: [
              { name: "show", params: [], returns: "bool", swift: { name: "show()", async: true } },
            ],
          },
        ],
      }),
    );

    expect(d).toMatch(
      /\* Main thread only: call it inside `main\(\(\) => …\)`\.\n[^/]*\*\/\n  static review\(\): void;/,
    );
    expect(d).not.toMatch(/Main thread only[^/]*\*\/\n  static refund/);
    expect(d).toMatch(
      /\* Any thread: no `main\(\(\) => …\)` needed\.\n[^/]*\*\/\n  show\(signal\?: AbortSignal\): Promise<boolean>;/,
    );
  });

  it("types an option set as its cases or 0, the empty set no case names", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Kit",
        types: [
          {
            kind: "enum",
            name: "KITEdges",
            native: "KITEdges",
            options: true,
            cases: [{ name: "top", native: "KITEdgesTop", value: 1 }],
          },
          {
            kind: "class",
            name: "KITView",
            native: "KITView",
            properties: [{ name: "edges", type: "KITEdges", setter: "setEdges:" }],
          },
        ],
      }),
    );

    expect(d).toContain("  edges: KITEdges | 0;");
  });

  it("documents what the binding plans refuse, as declared", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Kit",
        types: [
          {
            kind: "class",
            name: "KITView",
            native: "KITView",
            constructors: [{ params: [], selector: "init" }],
            methods: [
              { name: "grid", selector: "grid", params: [], returns: "string[][]" },
              {
                name: "fill",
                selector: "fill:",
                params: [{ name: "g", type: "string[][]" }],
                returns: "void",
              },
            ],
            properties: [{ name: "tag", type: "NSInteger" }],
          },
        ],
      }),
    );

    expect(d).toContain(
      "  /**\n   * Lucent cannot use this yet: nested collections from Objective-C are not supported yet.\n   * Native: -[KITView grid], in Kit.\n   */\n  grid(): string[][];",
    );
    expect(d).toContain("  fill(g: string[][]): void;");
    // A property without a setter selector: read, never written.
    expect(d).toContain(
      "  /**\n   * Lucent cannot assign this yet: it has no setter.\n   * Native: -[KITView tag], in Kit.\n   */\n  tag: bigint;",
    );
  });

  it("declares Swift types without NSObject, and plain Swift enums by case index", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Shapes",
        types: [
          {
            kind: "class",
            name: "Point",
            native: "Shapes.Point",
            swift: { kind: "struct" },
            constructors: [
              { params: [{ name: "x", type: "double" }], swift: { name: "init(x:)" } },
            ],
          },
          {
            kind: "enum",
            name: "Palette",
            native: "Shapes.Palette",
            swift: { kind: "enum" },
            cases: [
              { name: "red", native: "red", value: 0 },
              { name: "green", native: "green", value: 1 },
            ],
          },
        ],
      }),
    );
    expect(d).toContain("export declare class Point {");
    expect(d).not.toContain("NSObject");
    expect(d).toContain("export declare enum Palette {\n  red = 0,\n  green = 1,\n}");
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

  it("declares Swift enums with payloads as unions discriminated by kind", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Shapes",
        types: [
          {
            kind: "class",
            name: "Shape",
            native: "Shapes.Shape",
            swift: {
              kind: "enum",
              cases: [
                {
                  name: "circle",
                  params: [
                    { label: "center", type: "Point" },
                    { label: "radius", type: "double" },
                  ],
                },
                { name: "square", params: [{ label: "side", type: "double" }] },
              ],
            },
          },
          {
            kind: "class",
            name: "Stroke",
            native: "Shapes.Stroke",
            swift: {
              kind: "enum",
              cases: [
                { name: "none", params: [] },
                { name: "solid", params: [{ type: "double" }] },
                { name: "dashed", params: [{ type: "double" }, { type: "double" }] },
              ],
            },
          },
          { kind: "class", name: "Point", native: "Shapes.Point", swift: { kind: "struct" } },
          {
            kind: "class",
            name: "Outcome",
            native: "Shapes.Outcome",
            typeParams: ["T"],
            swift: {
              kind: "enum",
              cases: [
                { name: "done", params: [{ type: "T" }] },
                { name: "failed", params: [{ type: "string?" }] },
              ],
            },
          },
        ],
      }),
    );
    // Generic ones are generic unions.
    expect(d).toContain(
      'export declare type Outcome<T = unknown> = { kind: "done"; value: T } | { kind: "failed"; value: string | null };',
    );
    expect(d).toContain(
      'export declare type Shape = { kind: "circle"; center: Point; radius: number } | { kind: "square"; side: number };',
    );
    // A payload without a label is `value`, several are `_0`, `_1`…
    expect(d).toContain(
      'export declare type Stroke = { kind: "none" } | { kind: "solid"; value: number } | { kind: "dashed"; _0: number; _1: number };',
    );
  });

  it("declares async Swift members as promises, cancelled by a signal", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Shapes",
        types: [
          {
            kind: "class",
            name: "Canvas",
            native: "Shapes.Canvas",
            swift: { kind: "class" },
            methods: [
              {
                name: "area",
                params: [],
                returns: "double",
                swift: { name: "area()", async: true, throws: true },
              },
            ],
            properties: [
              {
                name: "ready",
                type: "bool",
                readonly: true,
                swift: { name: "ready", async: true },
              },
            ],
          },
        ],
        functions: [
          { name: "render", params: [], returns: "void", swift: { name: "render()", async: true } },
          {
            name: "greet",
            params: [
              { name: "name", type: "string" },
              { name: "punctuation", type: "string", defaulted: "optional" },
              { name: "isolation", type: "id", defaulted: "omitted" },
            ],
            returns: "string",
            swift: { name: "greet(_:punctuation:isolation:)", async: true },
          },
        ],
      }),
    );
    expect(d).toContain("  area(signal?: AbortSignal): Promise<number>;");
    // A getter takes no signal.
    expect(d).toContain("  readonly ready: Promise<boolean>;");
    expect(d).toContain("export declare function render(signal?: AbortSignal): Promise<void>;");
    // Default arguments: optional, or left out; the signal after them.
    expect(d).toContain(
      "export declare function greet(name: string, punctuation?: string, signal?: AbortSignal): Promise<string>;",
    );
  });

  it("declares Kotlin suspend functions as cancellable promises, and defaults a shim leaves out", () => {
    const search = "(Ljava/lang/String;ILkotlin/coroutines/Continuation;)Ljava/lang/Object;";
    const d = sdkDts(
      typed({
        platform: "android",
        module: "dev.orbit",
        types: [
          {
            kind: "class",
            name: "Client",
            native: "dev/orbit/Client",
            kotlin: { kind: "class" },
            constructors: [
              {
                params: [
                  { name: "name", type: "string", kotlin: { default: true } },
                  { name: "token", type: "string?", kotlin: { default: true } },
                ],
              },
            ],
            methods: [
              {
                name: "search",
                params: [
                  { name: "prefix", type: "string" },
                  { name: "limit", type: "int", kotlin: { default: true } },
                ],
                returns: "string",
                descriptor: search,
                kotlin: { suspend: true },
              },
              {
                name: "toQuery",
                static: true,
                params: [
                  { name: "receiver", type: "string" },
                  { name: "limit", type: "int", kotlin: { default: true } },
                ],
                returns: "string",
                kotlin: { extension: true },
              },
              {
                name: "configure",
                params: [
                  { name: "retries", type: "int", kotlin: { default: true } },
                  { name: "label", type: "string" },
                ],
                returns: "void",
              },
              {
                name: "pick",
                typeParams: ["T"],
                params: [
                  { name: "items", type: "T[]" },
                  { name: "fallback", type: "T?", kotlin: { default: true } },
                ],
                returns: "T?",
              },
              {
                name: "best",
                typeParams: ["T"],
                params: [
                  { name: "items", type: "T[]" },
                  { name: "fallback", type: "T?", kotlin: { default: true } },
                ],
                returns: "T?",
                kotlin: { bounds: { T: "other" } },
              },
            ],
          },
        ],
      }),
    );

    expect(d).toContain(
      "  search(prefix: string, limit?: number, signal?: AbortSignal): Promise<string>;",
    );
    expect(d).toContain("  constructor(name?: string, token?: string | null);");
    expect(d).toContain("  static toQuery(receiver: string, limit?: number): string;");
    // A default before a parameter without one: undefined leaves it out.
    expect(d).toContain("  configure(retries: number | undefined, label: string): void;");
    // A generic member's shim writes its type parameters as Any?, unless Kotlin bounds them.
    expect(d).toContain("  pick<T>(items: T[], fallback?: T | null): T | null;");
    expect(d).toContain("  best<T>(items: T[], fallback: T | null): T | null;");
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

  it("declares protocol requirements in their completion-handler form only, so classes can implement them", () => {
    const d = sdkDts(
      typed({
        platform: "ios",
        module: "Widgets",
        types: [
          {
            kind: "class",
            name: "WDGUploadDelegate",
            native: "WDGUploadDelegate",
            interface: true,
            methods: [
              {
                name: "needStream",
                selector: "needStreamWithCompletionHandler:",
                params: [{ name: "completionHandler", type: "@escaping (id?) => void" }],
                returns: "void",
                optional: true,
                async: { returns: "id?" },
              },
            ],
          },
        ],
      }),
    );
    expect(d).toContain("  needStream?(completionHandler: (arg0: NSObject | null) => void): void;");
    expect(d).not.toContain("Promise");
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

  it("declare Swift classes without NSObject", () => {
    const d = stubDts("ios", "Kit", {
      module: "Kit",
      refs: {},
      aliases: {},
      types: { KToken: { kind: "class", native: "Kit.KToken", swift: true } },
    });
    expect(d).toContain("export declare class KToken {");
    expect(d).not.toContain("extends NSObject");
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
