import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { extractAndroid } from "../src/android.ts";
import { type ModuleLookup, planMember, unsupportedReason } from "../src/binding-plan.ts";
import { coverage } from "../src/coverage.ts";
import { UNKNOWN_FACTS } from "../src/facts.ts";
import { extractIos } from "../src/ios.ts";
import {
  loadSchema,
  parseSchemaType,
  SCHEMA_FORMAT,
  type SdkClassSchema,
  type SdkModuleSchema,
} from "../src/schema.ts";
import { swiftModule } from "./swift-module.ts";

/** A schema type from its written form (`string?`, `Widgets.WDGWidget`). */
const T = (s: string, typeParams: string[] = []) => parseSchemaType(s, "", typeParams);

/** A lookup over these schemas; any other module is missing. */
const lookupOf =
  (...schemas: SdkModuleSchema[]): ModuleLookup =>
  (module) => {
    const schema = schemas.find((s) => s.module === module);
    return schema ? { schema } : { missing: `no ${module}` };
  };

const main = {
  affinity: "main",
  blocking: "unknown",
  ownership: "unknown",
  evidence: [{ fact: "affinity", source: "attribute", detail: "@MainActor" }],
} as const;

const widgets = loadSchema({
  format: SCHEMA_FORMAT,
  platform: "ios",
  module: "Widgets",
  provenance: {
    artifact: "clang-module:Widgets",
    kind: "clang-module",
    target: "arm64-apple-ios15.1-simulator",
    extractor: "0",
  },
  types: [
    {
      kind: "class",
      name: "WDGWidget",
      native: "WDGWidget",
      symbol: "objc:c:objc(cs)WDGWidget",
      mainActor: true,
      facts: main,
      since: "15.0",
      constructors: [
        {
          params: [{ name: "style", type: T("Widgets.WDGStyle") }],
          selector: "initWithStyle:",
          symbol: "objc:c:objc(cs)WDGWidget(im)initWithStyle:",
        },
      ],
      methods: [
        {
          name: "touch",
          selector: "touch:other:",
          params: [
            { name: "shape", type: T("Widgets.WDGWidget") },
            { name: "other", type: T("Widgets.WDGWidget?") },
          ],
          returns: T("void"),
          symbol: "objc:c:objc(cs)WDGWidget(im)touch:other:",
        },
        {
          name: "measure",
          selector: "measure:at:",
          params: [
            { name: "level", type: T("NSInteger") },
            { name: "at", type: T("Widgets.WDGPoint") },
          ],
          returns: T("string[]"),
          since: "16.0",
          facts: { ...UNKNOWN_FACTS, affinity: "any" },
        },
        {
          name: "watch",
          selector: "watch:",
          params: [{ name: "block", type: T("@escaping (bool) => void") }],
          returns: T("Foundation.NSURL?"),
        },
        {
          name: "shared",
          selector: "shared",
          static: true,
          params: [],
          returns: T("Widgets.WDGWidget"),
        },
      ],
      properties: [
        { name: "label", type: T("string?"), symbol: "objc:c:objc(cs)WDGWidget(py)label" },
      ],
    },
    {
      kind: "enum",
      name: "WDGStyle",
      native: "WDGStyle",
      cases: [{ name: "light", native: "WDGStyleLight", value: 0 }],
    },
    {
      kind: "struct",
      name: "WDGPoint",
      native: "WDGPoint",
      fields: [{ name: "x", type: T("double") }],
    },
  ],
  functions: [
    {
      name: "WDGDistance",
      params: [{ name: "a", type: T("Widgets.WDGWidget") }],
      returns: T("double"),
      symbol: "c:c:@F@WDGDistance",
    },
  ],
});

const foundation = loadSchema({
  format: SCHEMA_FORMAT,
  platform: "ios",
  module: "Foundation",
  provenance: {
    artifact: "sdk:iphonesimulator27.0",
    kind: "sdk",
    target: "arm64-apple-ios15.1-simulator",
    extractor: "0",
  },
  types: [{ kind: "class", name: "NSURL", native: "NSURL" }],
});

const widget = widgets.types[0] as SdkClassSchema;
const method = (name: string) => widget.methods!.find((m) => m.name === name)!;
const lookup = lookupOf(widgets, foundation);

describe("binding plans", () => {
  it("plans an Objective-C method: receiver, inputs, output, facts, availability", () => {
    expect(planMember(widget, method("touch"), widgets, lookup)).toEqual({
      symbol: "objc:c:objc(cs)WDGWidget(im)touch:other:",
      display: "WDGWidget.touch",
      backend: "objc",
      role: "call",
      artifact: "clang-module:Widgets",
      receiver: { op: "retain-object", type: T("Widgets.WDGWidget") },
      inputs: [
        { op: "retain-object", type: T("Widgets.WDGWidget") },
        {
          op: "optional",
          type: T("Widgets.WDGWidget?"),
          of: [{ op: "retain-object", type: T("Widgets.WDGWidget") }],
        },
      ],
      output: { op: "passthrough", type: T("void") },
      // The class's facts, for a member without its own.
      facts: main,
      availability: { platform: "ios", since: "15.0" },
      requiredArtifacts: ["clang-module:Widgets"],
    });
  });

  it("converts numbers by their native type, and enums, structs and arrays by rule", () => {
    const plan = planMember(widget, method("measure"), widgets, lookup);

    expect(plan.inputs).toEqual([
      // A 64-bit integer: a bigint, exactly or RangeError.
      { op: "bigint", type: T("NSInteger"), detail: "NSInteger" },
      { op: "struct", type: T("Widgets.WDGPoint") },
    ]);
    expect(plan.output).toEqual({
      op: "copy-array",
      type: T("string[]"),
      of: [{ op: "copy-string", type: T("string") }],
    });
    // Its own facts, and its own availability.
    expect(plan.facts.affinity).toBe("any");
    expect(plan.availability).toEqual({ platform: "ios", since: "16.0" });
    expect(planMember(widget, widget.constructors![0]!, widgets, lookup)).toMatchObject({
      display: "WDGWidget.constructor",
      inputs: [{ op: "enum", type: T("Widgets.WDGStyle") }],
      output: { op: "retain-object", type: T("Widgets.WDGWidget") },
    });
  });

  it("installs callbacks with their timing, and links the artifacts the types come from", () => {
    const plan = planMember(widget, method("watch"), widgets, lookup);

    expect(plan.inputs).toEqual([
      {
        op: "callback",
        type: T("@escaping (bool) => void"),
        detail: "escaping",
        // It returns nothing and escapes: queued on the Lucent thread.
        delivery: "queued",
        of: [
          // Offered to the Lucent function, which may leave it out: omissible.
          { op: "passthrough", type: T("bool"), omissible: true },
          { op: "passthrough", type: T("void") },
        ],
      },
    ]);
    expect(plan.requiredArtifacts).toEqual(["clang-module:Widgets", "sdk:iphonesimulator27.0"]);
  });

  it("takes no receiver for statics, C functions or constructors, and reads properties", () => {
    expect(planMember(widget, method("shared"), widgets, lookup)).not.toHaveProperty("receiver");
    expect(planMember(undefined, widgets.functions![0]!, widgets, lookup)).toMatchObject({
      symbol: "c:c:@F@WDGDistance",
      display: "Widgets.WDGDistance",
      backend: "c-abi",
      inputs: [{ op: "retain-object" }],
      output: { op: "number", detail: "double" },
      facts: UNKNOWN_FACTS,
      requiredArtifacts: ["clang-module:Widgets"],
    });
    expect(planMember(widget, widget.properties![0]!, widgets, lookup)).toMatchObject({
      display: "WDGWidget.label",
      receiver: { op: "retain-object" },
      inputs: [],
      output: { op: "optional", of: [{ op: "copy-string" }] },
    });
  });

  it("says why a member cannot be bound: a type that is not declared", () => {
    const broken = {
      name: "broken",
      params: [{ name: "url", type: T("Foundation.NSURL") }],
      returns: T("Widgets.WDGMissing?"),
    };

    const plan = planMember(widget, broken, widgets, lookup);

    expect(plan.output).toEqual({
      op: "optional",
      type: T("Widgets.WDGMissing?"),
      of: [
        {
          op: "unsupported",
          type: T("Widgets.WDGMissing"),
          reason: "refers to Widgets.WDGMissing, which is not declared",
        },
      ],
    });
    expect(unsupportedReason(plan)).toBe("refers to Widgets.WDGMissing, which is not declared");
    // A module the lookup does not have declares nothing.
    expect(unsupportedReason(planMember(widget, broken, widgets, lookupOf(widgets)))).toBe(
      "refers to Foundation.NSURL, which is not declared",
    );
    expect(unsupportedReason(planMember(widget, method("touch"), widgets, lookup))).toBeUndefined();
  });

  it("holds iOS references to their type's arity, and lets Java's raw types through", () => {
    const boxes = loadSchema({
      format: SCHEMA_FORMAT,
      platform: "ios",
      module: "Boxes",
      types: [{ kind: "class", name: "Box", native: "Box", typeParams: ["T"] }],
    });
    const raw = { name: "raw", params: [], returns: T("Boxes.Box") };
    const typed = { name: "typed", params: [], returns: T("Boxes.Box<string>") };

    expect(unsupportedReason(planMember(undefined, raw, boxes, lookupOf(boxes)))).toBe(
      "refers to Boxes.Box, which is not declared",
    );
    expect(planMember(undefined, typed, boxes, lookupOf(boxes)).output).toEqual({
      op: "retain-object",
      type: T("Boxes.Box<string>"),
      of: [{ op: "copy-string", type: T("string") }],
    });

    const java = { ...boxes, platform: "android" as const };
    expect(unsupportedReason(planMember(undefined, raw, java, lookupOf(java)))).toBeUndefined();
  });

  it("refuses over JNI what Java has no type for, and copies Java arrays of bytes", () => {
    const pkg = loadSchema({
      format: SCHEMA_FORMAT,
      platform: "android",
      module: "com.example",
      types: [
        {
          kind: "class",
          name: "Store",
          native: "com/example/Store",
          methods: [
            {
              name: "read",
              params: [{ name: "arg0", type: T("CharSequence") }],
              returns: T("byte[]?"),
              descriptor: "(Ljava/lang/CharSequence;)[B",
              symbol: "jvm:com/example/Store#read(Ljava/lang/CharSequence;)[B",
            },
            { name: "write", params: [{ name: "arg0", type: T("NSData") }], returns: T("void") },
          ],
        },
      ],
    });
    const store = pkg.types[0] as SdkClassSchema;

    const read = planMember(store, store.methods![0]!, pkg, lookupOf(pkg));

    expect(read).toMatchObject({
      backend: "jni",
      inputs: [{ op: "copy-string", detail: "CharSequence" }],
      output: { op: "optional", of: [{ op: "copy-bytes", detail: "byte[]" }] },
    });
    expect(unsupportedReason(planMember(store, store.methods![1]!, pkg, lookupOf(pkg)))).toBe(
      "bytes values are not Java types",
    );
  });
});

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const xcode =
  process.platform === "darwin" &&
  spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]).status === 0;
const javac =
  spawnSync("javac", ["-version"]).status === 0 && spawnSync("jar", ["--version"]).status === 0;

/** Every member of a schema, with its class (none for functions and constants). */
function membersOf(schema: SdkModuleSchema) {
  return [
    ...schema.types.flatMap((t) =>
      t.kind === "class"
        ? [...(t.constructors ?? []), ...(t.methods ?? []), ...(t.properties ?? [])].map(
            (member) => ({ owner: t as SdkClassSchema | undefined, member }),
          )
        : [],
    ),
    ...[...(schema.functions ?? []), ...(schema.constants ?? [])].map((member) => ({
      owner: undefined,
      member,
    })),
  ];
}

describe.skipIf(!xcode)("binding plans and coverage, Swift", () => {
  const [shapes] = xcode
    ? extractIos({ modules: ["Shapes"], includePaths: [swiftModule("Shapes")] })
    : [];

  it("gives an unsupported member the reason coverage counts it under", () => {
    // The member the extractor leaves out: `broken() -> Broken?`, whose enum has no Lucent type.
    const broken = {
      name: "broken",
      params: [],
      returns: T("Shapes.Broken?"),
      swift: { name: "broken()" },
    };
    const reason = unsupportedReason(planMember(undefined, broken, shapes!, lookupOf(shapes!)));

    expect(reason).toBe("refers to Shapes.Broken, which is not declared");
    expect(Object.keys(coverage(shapes!).reasons)).toContain(reason);
  });

  it("plans every member the extractor binds through a Swift shim, refusing what calls refuse", () => {
    const plans = membersOf(shapes!).map(({ owner, member }) =>
      planMember(owner, member, shapes!, lookupOf(shapes!)),
    );

    expect(plans.length).toBeGreaterThan(30);
    expect(plans.every((p) => p.backend === "swift-shim" && p.symbol !== "")).toBe(true);
    // Protocols with associated types: their requirements are declared (typed
    // by the protocol's type parameters), but not callable yet.
    expect(
      plans.flatMap((p) => (unsupportedReason(p) ? [`${p.display}: ${unsupportedReason(p)}`] : [])),
    ).toEqual([
      "Container.first: members of protocols with associated types cannot be called yet",
      "Accumulator.constructor: members of protocols with associated types cannot be called yet",
      "Accumulator.feed: members of protocols with associated types cannot be called yet",
      "Accumulator.output: members of protocols with associated types cannot be called yet",
    ]);
  });
});

describe.skipIf(!javac)("binding plans, Android", () => {
  it("plans every member the extractor binds over JNI, unrefused", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plan-"));
    const sources = spawnSync("find", [path.join(fixtures, "java"), "-name", "*.java"], {
      encoding: "utf8",
    })
      .stdout.trim()
      .split("\n");
    spawnSync("javac", ["--release", "11", "-d", path.join(dir, "classes"), ...sources]);
    spawnSync("jar", ["cf", path.join(dir, "fixture.jar"), "-C", path.join(dir, "classes"), "."]);
    const annotations = path.join(dir, "annotations.zip");
    spawnSync("jar", ["cfM", annotations, "-C", path.join(fixtures, "annotations"), "."]);
    const modules = extractAndroid({
      jars: [path.join(dir, "fixture.jar")],
      annotations,
      packages: [
        "com.example.widgets",
        "com.example.base",
        "com.example.tasks",
        "com.google.android.gms.tasks",
        "com.google.common.util.concurrent",
      ],
    });

    const plans = modules.flatMap((m) =>
      membersOf(m).map(({ owner, member }) => planMember(owner, member, m, lookupOf(...modules))),
    );

    expect(plans.length).toBeGreaterThan(50);
    expect(plans.every((p) => p.backend === "jni" && p.symbol?.startsWith("jvm:"))).toBe(true);
    expect(
      plans.flatMap((p) => (unsupportedReason(p) ? [`${p.display}: ${unsupportedReason(p)}`] : [])),
    ).toEqual([]);
    expect(plans.find((p) => p.display === "Widget.getName")!.facts).toMatchObject({
      affinity: "worker",
      evidence: [{ detail: "@WorkerThread" }],
    });
  });
});
