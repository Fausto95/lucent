/**
 * Values Swift shims and Objective-C glue convert that once refused their
 * members: optional numbers and booleans (as NSNumbers), Objective-C enums
 * in Swift signatures (as their raw values), and errors passed to
 * Objective-C (as NSErrors). Typed from a schema set, so the generated
 * code is checked on any machine; the Xcode suites compile and run it.
 */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "Kit",
      header: "Kit/Kit.h",
      types: [
        {
          kind: "enum",
          name: "KITEdges",
          native: "KITEdges",
          cases: [
            { name: "top", native: "KITEdgesTop", value: 1 },
            { name: "left", native: "KITEdgesLeft", value: 2 },
          ],
        },
        {
          kind: "enum",
          name: "KITCorners",
          native: "KITCorners",
          options: true,
          cases: [{ name: "round", native: "KITCornersRound", value: 1 }],
        },
        {
          kind: "class",
          name: "KITReporter",
          native: "KITReporter",
          constructors: [{ params: [], selector: "init" }],
          methods: [
            {
              name: "report",
              selector: "report:",
              params: [{ name: "error", type: "error" }],
              returns: "void",
            },
            {
              name: "reportMaybe",
              selector: "reportMaybe:",
              params: [{ name: "error", type: "error?" }],
              returns: "void",
            },
          ],
        },
      ],
    },
    {
      module: "Gauges",
      frameworks: [],
      types: [
        {
          kind: "class",
          name: "Meter",
          native: "Gauges.Meter",
          swift: { kind: "class" },
          constructors: [{ params: [], swift: { name: "init()" } }],
          methods: [
            {
              name: "width",
              params: [{ name: "at", type: "double?" }],
              returns: "double?",
              swift: { name: "width(at:)" },
            },
            {
              name: "enabled",
              params: [],
              returns: "bool?",
              swift: { name: "enabled()" },
            },
            {
              name: "edge",
              params: [{ name: "e", type: "Kit.KITEdges" }],
              returns: "Kit.KITEdges",
              swift: { name: "edge(_:)" },
            },
            {
              name: "corners",
              params: [],
              returns: "Kit.KITCorners",
              swift: { name: "corners()" },
            },
            {
              name: "area",
              params: [],
              returns: "double",
              swift: { name: "area()" },
            },
            {
              name: "ready",
              params: [],
              returns: "bool",
              swift: { name: "ready()", async: true },
            },
          ],
          properties: [{ name: "limit", type: "int64?", swift: { name: "limit" } }],
        },
      ],
    },
  ]);

describe("Swift and Objective-C crossings", () => {
  it("passes optional numbers and booleans to Swift as NSNumbers, nil for null", () => {
    const p = setProgram(
      `import { Meter } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const m = new Meter();
  m.limit = null;
  m.limit = 5n;
  return \`\${m.width(2)} \${m.width(null)} \${m.enabled()} \${m.limit}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    // The shim takes and gives optional objects, bridged to Double? and Bool?.
    expect(p.shims).toMatch(/_ a0: UnsafeMutableRawPointer\?\) -> UnsafeMutableRawPointer\?/);
    expect(p.shims).toContain("as! Double");
    expect(p.shims).toContain("as NSNumber");
    // The glue boxes what it passes and reads NSNumbers back, nil as null.
    expect(p.mm).toMatch(/@\(/);
    expect(p.mm).toContain("doubleValue");
    expect(p.mm).toContain("boolValue");
    expect(p.mm).toContain("longLongValue");
  });

  it("reads numbers and booleans that aren't optional back as scalars", () => {
    const p = setProgram(
      `import { Meter } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const m = new Meter();
  return \`\${m.area()} \${await m.ready()}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    // The shim gives a Double and a Bool, which the glue reads as they are.
    expect(p.mm).toMatch(/double r_ = lucent_swift_/);
    expect(p.mm).not.toContain("id e_ = r_");
  });

  it("passes Objective-C enums to Swift as their raw values", () => {
    const p = setProgram(
      `import { Meter } from "lucent:ios/Gauges";
import { KITCorners, KITEdges } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  const m = new Meter();
  return \`\${m.edge(KITEdges.left) === KITEdges.top} \${m.corners() === KITCorners.round}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain("Kit.KITEdges(rawValue: .init(truncatingIfNeeded: a0))!");
    expect(p.shims).toContain("Int(truncatingIfNeeded: v.rawValue)");
    // An option set's init(rawValue:) is not failable.
    expect(p.shims).not.toContain("Kit.KITCorners(rawValue: .init(truncatingIfNeeded: a0))!");
  });

  it("passes errors to Objective-C as NSErrors", () => {
    const p = setProgram(
      `import { KITReporter } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  const r = new KITReporter();
  r.report(new Error("broke"));
  r.reportMaybe(null);
  return "";
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.mm).toContain("lucent::objc::toNSError(");
    expect(p.mm).toContain("report:");
  });
});

describe("optional closures and tuples through Swift shims", () => {
  const fn = (nullable: boolean) => ({
    k: "fn",
    params: [{ k: "prim", name: "double", nullable: false }],
    ret: { k: "prim", name: "void", nullable: false },
    nullable,
  });
  const pair = (nullable: boolean) => ({
    k: "tuple",
    of: [
      { k: "prim", name: "double", nullable: false },
      { k: "string", nullable: false },
    ],
    nullable,
  });
  const set = () =>
    schemaSet([
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Meter",
            native: "Gauges.Meter",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "observe",
                params: [{ name: "handler", type: fn(true) }],
                returns: "void",
                swift: { name: "observe(_:)" },
              },
              { name: "current", params: [], returns: fn(true), swift: { name: "current()" } },
              { name: "peak", params: [], returns: pair(true), swift: { name: "peak()" } },
              {
                name: "mark",
                params: [{ name: "at", type: pair(true) }],
                returns: "void",
                swift: { name: "mark(_:)" },
              },
            ],
            properties: [
              { name: "onChange", type: fn(true), swift: { name: "onChange" } },
              { name: "onReset", type: fn(false), swift: { name: "onReset" } },
            ],
          },
        ],
      },
    ]);

  it("pass a closure, or none, as an optional block", () => {
    const p = setProgram(
      `import { Meter } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const m = new Meter();
  m.observe((x: number) => {});
  m.observe(null);
  m.onChange = (x: number) => {};
  m.onReset = (x: number) => {};
  m.onChange = null;
  const f = m.onChange;
  const g = m.current();
  if (g) g(2);
  return \`\${f === null}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    // The shim takes an optional object, the block Swift calls as a closure.
    expect(p.shims).toContain(
      "observe(a0.map { unsafeBitCast(lucentObject($0), to: (@convention(block) (Double) -> Void).self) })",
    );
    expect(p.shims).toContain(
      "return v.map { lucentRetained(unsafeBitCast($0 as @convention(block) (Double) -> Void, to: AnyObject.self)) }",
    );
    expect(p.shims).toContain(".onChange = a0.map {");
    // The glue makes a block of a function, and passes nil for null.
    expect(p.mm).toContain("lucent::objc::block<void (^)(double)>");
    expect(p.mm).toMatch(/id a0_ = nil;/);
  });

  it("pass a tuple, or none, as an optional array, and read one back", () => {
    const p = setProgram(
      `import { Meter } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const m = new Meter();
  m.mark([1, "a"]);
  m.mark(null);
  const peak = m.peak();
  return peak === null ? "none" : \`\${peak[0]} \${peak[1]}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain("mark(a0.map { ((lucentObject($0) as! [AnyObject])[0] as! Double");
    expect(p.shims).toContain("return v.map { lucentRetained([($0.0 as NSNumber) as AnyObject");
    // Null for nil, and the array's elements otherwise.
    expect(p.mm).toMatch(/o_ \? lucent::Opt<std::tuple<double, lucent::String>>\(/);
    expect(p.mm).toContain(": lucent::Opt<std::tuple<double, lucent::String>>(lucent::null)");
    expect(p.mm).toMatch(
      /lucent::objc::ifPresent\(lucent::Opt<std::tuple<double, lucent::String>>/,
    );
  });
});

describe("optionals and Objective-C enums in Swift collections and tuples", () => {
  const set = () =>
    schemaSet([
      {
        module: "Kit",
        header: "Kit/Kit.h",
        types: [
          {
            kind: "enum",
            name: "KITEdges",
            native: "KITEdges",
            cases: [
              { name: "top", native: "KITEdgesTop", value: 1 },
              { name: "left", native: "KITEdgesLeft", value: 2 },
            ],
          },
          {
            kind: "class",
            name: "KITView",
            native: "KITView",
            constructors: [{ params: [], selector: "init" }],
          },
        ],
      },
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Meter",
            native: "Gauges.Meter",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              { name: "readings", params: [], returns: "double?[]", swift: { name: "readings()" } },
              {
                name: "record",
                params: [{ name: "values", type: "double?[]" }],
                returns: "void",
                swift: { name: "record(_:)" },
              },
              {
                name: "edges",
                params: [{ name: "e", type: "Kit.KITEdges[]" }],
                returns: "Kit.KITEdges[]",
                swift: { name: "edges(_:)" },
              },
              { name: "views", params: [], returns: "Kit.KITView?[]", swift: { name: "views()" } },
              {
                name: "labels",
                params: [],
                returns: "Record<string?>",
                swift: { name: "labels()" },
              },
              {
                name: "pair",
                params: [],
                returns: {
                  k: "tuple",
                  of: [
                    { k: "prim", name: "double", nullable: true },
                    { k: "string", nullable: false },
                  ],
                  nullable: false,
                },
                swift: { name: "pair()" },
              },
            ],
          },
        ],
      },
    ]);

  it("cross absent optional elements as NSNull, and enums as their raw values", () => {
    const p = setProgram(
      `import { Meter } from "lucent:ios/Gauges";
import { KITEdges } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  const m = new Meter();
  const r = m.readings();
  m.record([1, null, 3]);
  const e = m.edges([KITEdges.top, KITEdges.left]);
  const v = m.views();
  const l = m.labels();
  const p = m.pair();
  return \`\${r.length} \${e.length} \${v.length} \${l["a"]} \${p[0]}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    // Swift: nil bridges as NSNull through Any; NSNull reads back as nil.
    expect(p.shims).toContain("v.map { $0.map { $0 as NSNumber } as Any } as NSArray");
    expect(p.shims).toContain("($0 as? NSNull != nil ? nil : $0 as! Double) as Double?");
    expect(p.shims).toContain("v.map { $0.map { $0 } as Any } as NSArray");
    expect(p.shims).toContain("(v.0.map { $0 as NSNumber } as Any) as AnyObject");
    expect(p.shims).toContain(
      "Kit.KITEdges(rawValue: .init(truncatingIfNeeded: ($0 as! NSNumber).intValue))!",
    );
    expect(p.shims).toContain("NSNumber(value: Int(truncatingIfNeeded: $0.rawValue))");
    // The glue: NSNull for null, null for NSNull, objects and numbers as they are.
    expect(p.mm).toContain("lucent::objc::orNSNull(lucent::objc::ifPresent(e_,");
    expect(p.mm).toContain(
      "lucent::objc::isNSNull(e_) ? lucent::Opt<double>(lucent::null) : lucent::Opt<double>([((NSNumber*)e_) doubleValue])",
    );
    expect(p.mm).toContain("lucent::Opt<lucent::NativeRef>(lucent::objc::wrap(e_,");
    expect(p.mm).toContain("@(lucent::toNativeNumber<KITEdges>(e_))");
  });
});

describe("C structs in Swift collections, and optional enums", () => {
  const set = () =>
    schemaSet([
      {
        module: "Kit",
        header: "Kit/Kit.h",
        types: [
          {
            kind: "enum",
            name: "KITEdges",
            native: "KITEdges",
            cases: [
              { name: "top", native: "KITEdgesTop", value: 1 },
              { name: "left", native: "KITEdgesLeft", value: 2 },
            ],
          },
          {
            kind: "struct",
            name: "KITPoint",
            native: "KITPoint",
            fields: [
              { name: "x", type: "double" },
              { name: "y", type: "double" },
            ],
          },
        ],
      },
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "enum",
            name: "Mode",
            native: "Gauges.Mode",
            swift: true,
            cases: [
              { name: "fast", native: "fast", value: 0 },
              { name: "slow", native: "slow", value: 1 },
            ],
          },
          {
            kind: "class",
            name: "Meter",
            native: "Gauges.Meter",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "points",
                params: [{ name: "ps", type: "Kit.KITPoint[]" }],
                returns: "Kit.KITPoint[]",
                swift: { name: "points(_:)" },
              },
              {
                name: "edge",
                params: [{ name: "e", type: "Kit.KITEdges?" }],
                returns: "Kit.KITEdges?",
                swift: { name: "edge(_:)" },
              },
              {
                name: "mode",
                params: [{ name: "m", type: "Gauges.Mode?" }],
                returns: "Gauges.Mode?",
                swift: { name: "mode(_:)" },
              },
            ],
            properties: [{ name: "lastEdge", type: "Kit.KITEdges?", swift: { name: "lastEdge" } }],
          },
        ],
      },
    ]);

  it("pass structs in arrays as their bytes, and optional enums as NSNumbers", () => {
    const p = setProgram(
      `import { Meter, Mode } from "lucent:ios/Gauges";
import { KITEdges } from "lucent:ios/Kit";
export async function run(): Promise<string> {
  const m = new Meter();
  const ps = m.points([{ x: 1, y: 2 }]);
  const e = m.edge(null);
  const g = m.mode(Mode.slow);
  m.lastEdge = KITEdges.top;
  return \`\${ps[0]!.x} \${e} \${g} \${m.lastEdge}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    // Swift: each struct's bytes; an optional enum's NSNumber, nil for none.
    expect(p.shims).toContain(
      "($0 as! Data).withUnsafeBytes { $0.loadUnaligned(as: KITPoint.self) }",
    );
    expect(p.shims).toContain(
      "v.map { withUnsafeBytes(of: $0) { Data($0) } as NSData } as NSArray",
    );
    expect(p.shims).toContain(
      "edge(a0.map { Kit.KITEdges(rawValue: .init(truncatingIfNeeded: (lucentObject($0) as! NSNumber).intValue))! })",
    );
    expect(p.shims).toContain(
      "return v.map { lucentRetained(NSNumber(value: Int(truncatingIfNeeded: $0.rawValue))) }",
    );
    expect(p.shims).toContain(
      "return v.map { lucentRetained(NSNumber(value: [Gauges.Mode.fast, Gauges.Mode.slow].firstIndex(of: $0) ?? -1)) }",
    );
    expect(p.shims).toMatch(
      /_ a0: UnsafeMutableRawPointer\?\) -> UnsafeMutableRawPointer\? \{\n  let v = \(lucentObject\(self_\) as! Gauges\.Meter\)\.edge/,
    );
    // The glue: structs' bytes, and NSNumbers of enums.
    expect(p.mm).toContain("lucent::objc::structBytes(KITPoint{");
    expect(p.mm).toContain("lucent::objc::structFromBytes<KITPoint>(e_)");
    expect(p.mm).toContain("return @(lucent::toNativeNumber<NSInteger>(x_));");
  });
});

describe("Swift requirements a Lucent class implements", () => {
  it("take and give optional numbers and Objective-C enums", () => {
    const set = schemaSet([
      {
        module: "Kit",
        header: "Kit/Kit.h",
        types: [
          {
            kind: "enum",
            name: "KITEdges",
            native: "KITEdges",
            cases: [{ name: "top", native: "KITEdgesTop", value: 1 }],
          },
        ],
      },
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Sensor",
            native: "Gauges.Sensor",
            swift: { kind: "protocol" },
            interface: true,
            methods: [
              {
                name: "reading",
                params: [{ name: "at", type: "double?" }],
                returns: "double?",
                abstract: true,
                swift: { name: "reading(at:)" },
              },
              {
                name: "edge",
                params: [],
                returns: "Kit.KITEdges",
                abstract: true,
                swift: { name: "edge()" },
              },
            ],
          },
          {
            kind: "class",
            name: "Station",
            native: "Gauges.Station",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "watch",
                params: [{ name: "s", type: "Gauges.Sensor" }],
                returns: "void",
                swift: { name: "watch(_:)" },
              },
            ],
          },
        ],
      },
    ]);
    const p = setProgram(
      `import { Station, type Sensor } from "lucent:ios/Gauges";
import { KITEdges } from "lucent:ios/Kit";
class Probe implements Sensor {
  reading(at: number | null): number | null {
    return at === null ? null : at * 2;
  }
  edge(): KITEdges {
    return KITEdges.top;
  }
}
export async function run(): Promise<string> {
  new Station().watch(new Probe());
  return "";
}
`,
      set,
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toMatch(/func reading\(at a0: Double\?\) -> Double\?/);
    expect(p.shims).toContain("a0.map { lucentRetained($0 as NSNumber) }");
    expect(p.shims).toMatch(/func edge\(\) -> Kit\.KITEdges/);
    expect(p.shims).toContain("Kit.KITEdges(rawValue: .init(truncatingIfNeeded:");
  });
});

describe("async initializers and effectful property requirements", () => {
  it("call an async initializer as a static factory, whose promise gives the object", () => {
    const set = schemaSet([
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Model",
            native: "Gauges.Model",
            swift: { kind: "class" },
            methods: [
              {
                name: "withContentsOf",
                static: true,
                params: [{ name: "url", type: "string" }],
                returns: "Gauges.Model",
                swift: { name: "init(contentsOf:)", async: true, throws: true },
              },
              {
                name: "make",
                static: true,
                params: [],
                returns: "Gauges.Model",
                swift: { name: "init()", async: true },
              },
            ],
          },
        ],
      },
    ]);
    const p = setProgram(
      `import { Model } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const a = await Model.withContentsOf("file:///x");
  const b = await Model.make();
  return \`\${a === b}\`;
}
`,
      set,
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain("let v = try await Gauges.Model.init(contentsOf: v0)");
    expect(p.shims).toContain("let v = await Gauges.Model.init()");
  });

  it("implement an async or throwing property requirement with a getter", () => {
    const set = schemaSet([
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Source",
            native: "Gauges.Source",
            swift: { kind: "protocol" },
            interface: true,
            properties: [
              {
                name: "level",
                type: "double",
                readonly: true,
                abstract: true,
                swift: { name: "level", async: true, throws: true },
              },
              {
                name: "label",
                type: "string",
                readonly: true,
                abstract: true,
                swift: { name: "label", throws: true },
              },
            ],
          },
          {
            kind: "class",
            name: "Station",
            native: "Gauges.Station",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "watch",
                params: [{ name: "s", type: "Gauges.Source" }],
                returns: "void",
                swift: { name: "watch(_:)" },
              },
            ],
          },
        ],
      },
    ]);
    const program = (members: string) =>
      setProgram(
        `import { Station, type Source } from "lucent:ios/Gauges";
class Feed implements Source {
${members}
}
export async function run(): Promise<string> {
  new Station().watch(new Feed());
  return "";
}
`,
        set,
      );
    const p = program(`  get level(): Promise<number> {
    return Promise.resolve(4);
  }
  get label(): string {
    throw new Error("no label");
  }`);

    expect(p.messages).toEqual([]);
    expect(p.shims).toMatch(
      /var level: Double \{\n    get async throws \{\n      return try await withCheckedThrowingContinuation/,
    );
    expect(p.shims).toMatch(/var label: String \{\n    get throws \{\n      var e_/);
    // The glue calls the getters, as a method requirement's.
    expect(p.mm).toContain("auto p_ = s_->get_level();");
    expect(p.mm).toContain("auto r_ = s_->get_label();");

    // A field cannot be one.
    const field = program(`  readonly level = Promise.resolve(4);
  get label(): string {
    return "";
  }`);
    expect(field.messages.map((m) => m[1]).join("\n")).toContain(
      "Source.level's getter is async: give Feed.level a getter, which returns a promise",
    );
  });
});

describe("statics of generic Swift types", () => {
  const T = { k: "tparam", name: "T", nullable: false };
  const U = { k: "tparam", name: "U", nullable: false };
  const set = () =>
    schemaSet([
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Box",
            native: "Gauges.Box",
            swift: { kind: "struct" },
            typeParams: ["T"],
            methods: [
              {
                name: "of",
                static: true,
                params: [{ name: "value", type: T }],
                returns: { k: "ref", module: "Gauges", name: "Box", nullable: false, args: [T] },
                swift: { name: "of(_:)" },
              },
              {
                name: "pair",
                static: true,
                typeParams: ["U"],
                params: [
                  { name: "a", type: T },
                  { name: "b", type: U },
                ],
                returns: "string",
                swift: { name: "pair(_:_:)" },
              },
            ],
            properties: [{ name: "value", type: T, readonly: true, swift: { name: "value" } }],
          },
        ],
      },
    ]);

  it("are called on the type their call's arguments fix", () => {
    const p = setProgram(
      `import { Box } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const b = Box.of(3);
  return \`\${b.value} \${Box.pair("x", true)}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain("let v: Gauges.Box<Double> = Gauges.Box<Double>.of(a0)");
    // The method's own come after the class's.
    expect(p.shims).toContain(
      "let v: String = Gauges.Box<String>.pair(lucentObject(a0) as! String, a1)",
    );
  });
});

describe("Swift subscripts", () => {
  const set = () =>
    schemaSet([
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Grid",
            native: "Gauges.Grid",
            swift: { kind: "struct" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "subscript",
                params: [
                  { name: "row", type: "double" },
                  { name: "column", type: "double" },
                ],
                returns: "string",
                swift: { name: "subscript(_:column:)", subscript: "get" },
              },
              {
                name: "setSubscript",
                params: [
                  { name: "row", type: "double" },
                  { name: "column", type: "double" },
                  { name: "newValue", type: "string" },
                ],
                returns: "void",
                swift: { name: "subscript(_:column:)", subscript: "set" },
              },
              // Overloads Swift names alike: told apart by their types.
              {
                name: "subscript",
                params: [{ name: "name", type: "string" }],
                returns: "double?",
                swift: { name: "subscript(_:)", subscript: "get", async: true, throws: true },
              },
              {
                name: "subscript",
                params: [{ name: "index", type: "double" }],
                returns: "double?",
                swift: { name: "subscript(_:)", subscript: "get" },
              },
              {
                name: "subscript",
                static: true,
                params: [{ name: "key", type: "string" }],
                returns: "double",
                swift: { name: "subscript(_:)", subscript: "get" },
              },
            ],
          },
          {
            kind: "class",
            name: "Lookup",
            native: "Gauges.Lookup",
            swift: { kind: "protocol" },
            interface: true,
            methods: [
              {
                name: "subscript",
                params: [{ name: "key", type: "string" }],
                returns: "string",
                abstract: true,
                swift: { name: "subscript(_:)", subscript: "get" },
              },
            ],
          },
          {
            kind: "class",
            name: "Index",
            native: "Gauges.Index",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "use",
                params: [{ name: "l", type: "Gauges.Lookup" }],
                returns: "void",
                swift: { name: "use(_:)" },
              },
            ],
          },
        ],
      },
    ]);

  it("read and write through Swift's subscript syntax", () => {
    const p = setProgram(
      `import { Grid } from "lucent:ios/Gauges";
export async function run(): Promise<string> {
  const g = new Grid();
  g.setSubscript(1, 2, "x");
  return \`\${g.subscript(1, 2)} \${await g.subscript("a")} \${g.subscript(3)} \${Grid.subscript("k")}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain(
      "(lucentObject(self_) as! LucentBox<Gauges.Grid>).value[a0, column: a1] = lucentObject(a2) as! String",
    );
    expect(p.shims).toContain(
      "(lucentObject(self_) as! LucentBox<Gauges.Grid>).value[a0, column: a1]",
    );
    expect(p.shims).toContain("let v = try await o_.value[v0]");
    expect(p.shims).toContain("(lucentObject(self_) as! LucentBox<Gauges.Grid>).value[a0]");
    expect(p.shims).toContain("Gauges.Grid[lucentObject(a0) as! String]");
  });

  it("are refused as requirements a Lucent class implements", () => {
    const p = setProgram(
      `import { Index, type Lookup } from "lucent:ios/Gauges";
class Table implements Lookup {
  subscript(key: string): string {
    return key;
  }
}
export async function run(): Promise<string> {
  new Index().use(new Table());
  return "";
}
`,
      set(),
    );

    expect(p.messages.join("\n")).toContain(
      "Table: Lookup requires subscript(_:): Lucent classes cannot implement subscript requirements",
    );
  });
});

describe("members of Swift protocols, on the value opened", () => {
  const Item = { k: "tparam", name: "Item", nullable: false };
  const Self = { k: "tparam", name: "Self", nullable: false };
  const string = { k: "string", nullable: false };
  const set = () =>
    schemaSet([
      {
        module: "Gauges",
        frameworks: [],
        types: [
          {
            kind: "class",
            name: "Store",
            native: "Gauges.Store",
            interface: true,
            typeParams: ["Item"],
            swift: { kind: "protocol", associatedTypes: true },
            methods: [
              { name: "get", params: [], returns: Item, abstract: true, swift: { name: "get()" } },
              {
                name: "put",
                params: [{ name: "item", type: Item }],
                returns: "void",
                abstract: true,
                swift: { name: "put(_:)", mutating: true },
              },
              {
                name: "all",
                params: [],
                returns: { k: "array", of: Item, nullable: false },
                abstract: true,
                swift: { name: "all()" },
              },
              {
                name: "merged",
                params: [{ name: "other", type: Self }],
                returns: Self,
                abstract: true,
                swift: { name: "merged(with:)" },
              },
              {
                name: "fetch",
                params: [],
                returns: Item,
                abstract: true,
                swift: { name: "fetch()", async: true, throws: true },
              },
            ],
            properties: [
              { name: "count", type: "NSInteger", readonly: true, swift: { name: "count" } },
              { name: "label", type: "string", swift: { name: "label" } },
            ],
          },
          {
            kind: "class",
            name: "Counter",
            native: "Gauges.Counter",
            interface: true,
            swift: { kind: "protocol" },
            methods: [
              {
                name: "bump",
                params: [],
                returns: "void",
                abstract: true,
                swift: { name: "bump()", mutating: true },
              },
            ],
            properties: [
              { name: "total", type: "double", readonly: true, swift: { name: "total" } },
            ],
          },
          {
            kind: "class",
            name: "Shelf",
            native: "Gauges.Shelf",
            swift: { kind: "struct" },
            implements: [
              { k: "ref", module: "Gauges", name: "Store", nullable: false, args: [string] },
              { k: "ref", module: "Gauges", name: "Counter", nullable: false },
            ],
            constructors: [{ params: [], swift: { name: "init()" } }],
          },
          {
            kind: "class",
            name: "Meter",
            native: "Gauges.Meter",
            swift: { kind: "class" },
            constructors: [{ params: [], swift: { name: "init()" } }],
            methods: [
              {
                name: "read",
                params: [{ name: "c", type: "Gauges.Counter" }],
                returns: "double",
                swift: { name: "read(_:)" },
              },
            ],
          },
        ],
      },
    ]);

  it("cast to and from the associated types the receiver's type arguments fix", () => {
    const p = setProgram(
      `import { Shelf, type Store } from "lucent:ios/Gauges";
async function use(s: Store<string>): Promise<string> {
  s.put("a");
  s.label = "x";
  const m = s.merged(s);
  return \`\${s.get()} \${s.all().length} \${s.count} \${s.label} \${m.get()} \${await s.fetch()}\`;
}
export async function run(): Promise<string> {
  return await use(new Shelf());
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    // Opened from a variable, through a function of its own.
    expect(p.shims).toContain("let o_ = lucentUnboxed(object_) as! any Gauges.Store");
    expect(p.shims).toContain("func opened_<S: Gauges.Store>(_ s: S) -> String {");
    expect(p.shims).toContain("return r as! String");
    expect(p.shims).toContain("return r as! [String]");
    // A mutating member's value is written back to its box.
    expect(p.shims).toContain("s.put((lucentObject(a0) as! String) as! S.Item)");
    expect(p.shims).toContain("box_.anyValue = s");
    // `Self` is the opened type, and comes back boxed as it.
    expect(p.shims).toContain("s.merged(with: lucentUnboxed(lucentObject(a0)) as! S)");
    expect(p.shims).toContain("return lucentBoxed(r)");
    expect(p.shims).toContain("func opened_<S: Gauges.Store>(_ s: S) async throws -> String {");
    expect(p.shims).toContain("protocol LucentBoxed: AnyObject {");
  });

  it("mutate a protocol's value through its box, and read a box as the protocol's value", () => {
    const p = setProgram(
      `import { Meter, Shelf, type Counter } from "lucent:ios/Gauges";
function bump(c: Counter): number {
  c.bump();
  return c.total;
}
export async function run(): Promise<string> {
  const s = new Shelf();
  return \`\${bump(s)} \${new Meter().read(s)}\`;
}
`,
      set(),
    );

    expect(p.messages).toEqual([]);
    expect(p.shims).toContain("func opened_<S: Gauges.Counter>(_ s: S) {");
    // What doesn't mutate is called on the existential.
    expect(p.shims).toContain("(lucentUnboxed(lucentObject(self_)) as! any Gauges.Counter).total");
    expect(p.shims).toContain("lucentUnboxed(lucentObject(a0)) as! any Gauges.Counter");
  });
});
