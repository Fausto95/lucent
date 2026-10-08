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
