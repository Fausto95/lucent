import { describe, expect, it } from "vite-plus/test";
import { parseSchemaType, SCHEMA_FORMAT, type SdkModuleSchema } from "../src/schema.ts";
import {
  compareArtifacts,
  diffModule,
  diffSymbols,
  displayName,
  findSymbol,
  sdkSymbols,
  symbolKey,
} from "../src/usage.ts";

/** A schema type from its written form (`string?`, `dev.orbit.Tracker`). */
const T = (s: string) => parseSchemaType(s, "dev.orbit", []);

const jvm = (member: string) => `jvm:dev/orbit/Tracker#${member}`;

/** Version 1 of a fictional tracking library, as bindgen would declare it. */
function v1(): SdkModuleSchema {
  return {
    format: SCHEMA_FORMAT,
    platform: "android",
    module: "dev.orbit",
    types: [
      {
        kind: "class",
        name: "Tracker",
        native: "dev/orbit/Tracker",
        symbol: "jvm:dev/orbit/Tracker",
        implements: ["dev.orbit.Named"],
        constructors: [{ params: [], symbol: jvm("<init>()V") }],
        methods: [
          {
            name: "name",
            params: [],
            returns: T("string"),
            symbol: jvm("name()Ljava/lang/String;"),
          },
          {
            name: "track",
            params: [{ name: "event", type: T("string") }],
            returns: T("void"),
            symbol: jvm("track(Ljava/lang/String;)V"),
          },
          { name: "level", params: [], returns: T("int"), symbol: jvm("level()I") },
          { name: "flush", params: [], returns: T("void"), symbol: jvm("flush()V"), since: 21 },
          {
            name: "setSize",
            params: [{ name: "size", type: T("long") }],
            returns: T("void"),
            symbol: jvm("setSize(J)V"),
          },
          { name: "unused", params: [], returns: T("void"), symbol: jvm("unused()V") },
        ],
        properties: [
          {
            name: "VERSION",
            type: T("string"),
            static: true,
            symbol: jvm("VERSION:Ljava/lang/String;"),
          },
        ],
      },
      {
        kind: "enum",
        name: "Mode",
        native: "dev/orbit/Mode",
        symbol: "jvm:dev/orbit/Mode",
        cases: [
          { name: "FAST", native: "FAST", value: 0 },
          { name: "SLOW", native: "SLOW", value: 1 },
        ],
      },
    ],
  };
}

/**
 * Version 2: track is gone, level returns a long, flush is deprecated and
 * needs a newer platform, a setSize(int) overload takes the name setSize
 * (the long one becomes setSize_long, calling the same method), SLOW is
 * gone, unused is gone and added is new.
 */
function v2(): SdkModuleSchema {
  const schema = v1();
  const tracker = schema.types[0]!;
  if (tracker.kind !== "class") throw new Error("Tracker is a class");

  tracker.methods = [
    { name: "name", params: [], returns: T("string"), symbol: jvm("name()Ljava/lang/String;") },
    { name: "level", params: [], returns: T("long"), symbol: jvm("level()J") },
    {
      name: "flush",
      params: [],
      returns: T("void"),
      symbol: jvm("flush()V"),
      since: 26,
      deprecated: true,
    },
    {
      name: "setSize",
      params: [{ name: "size", type: T("int") }],
      returns: T("void"),
      symbol: jvm("setSize(I)V"),
    },
    {
      name: "setSize_long",
      java: "setSize",
      params: [{ name: "size", type: T("long") }],
      returns: T("void"),
      symbol: jvm("setSize(J)V"),
    },
    { name: "added", params: [], returns: T("void"), symbol: jvm("added()V") },
  ];

  const mode = schema.types[1]!;
  if (mode.kind === "enum") mode.cases = [{ name: "FAST", native: "FAST", value: 0 }];

  return schema;
}

const used = (name: string) => {
  const s = sdkSymbols(v1()).find((x) => x.name === name);
  if (!s) throw new Error(`no ${name} in v1`);
  return s;
};

describe("SDK symbols", () => {
  it("names each type and member by its native identity, whatever TypeScript calls it", () => {
    const symbols = sdkSymbols(v1());

    expect(symbols.map(symbolKey)).toContain(
      "android/dev.orbit/Tracker/method:jvm:dev/orbit/Tracker#level()I",
    );
    expect(symbols.map(displayName)).toEqual(
      expect.arrayContaining([
        "Tracker",
        "new Tracker()",
        "Tracker.level",
        "Tracker.VERSION",
        "Mode",
      ]),
    );

    // A declaration without a symbol is keyed by its name and signature.
    const bare = sdkSymbols({ ...v1(), types: [{ ...v1().types[0]!, symbol: undefined }] });
    expect(bare.map(symbolKey)).toContain(
      "android/dev.orbit//type:Tracker class implements dev.orbit.Named",
    );
  });

  it("describes what a use depends on: the signature, availability and deprecation", () => {
    expect(used("track")).toMatchObject({
      kind: "method",
      owner: "Tracker",
      signature: "(string) => void",
    });
    expect(used("flush")).toMatchObject({ since: 21 });
    expect(used("VERSION")).toMatchObject({ kind: "property", static: true, signature: "string" });
    expect(used("Mode")).toMatchObject({ kind: "type", cases: ["FAST", "SLOW"] });
    expect(used("Tracker")).toMatchObject({
      kind: "type",
      signature: "class implements dev.orbit.Named",
    });
  });

  it("finds a symbol in another version by its native identity first, then by name", () => {
    expect(findSymbol(v2(), used("setSize"))?.name).toBe("setSize_long");
    expect(findSymbol(v2(), used("level"))?.signature).toBe("() => long");
    expect(findSymbol(v2(), used("track"))).toBeUndefined();
  });
});

describe("SDK diffs", () => {
  it("reports what changed for the symbols an app uses, with stable names for the rest", () => {
    const changes = diffSymbols(
      ["name", "track", "level", "flush", "setSize", "Mode"].map(used),
      (_, module) => (module === "dev.orbit" ? v2() : { missing: `no ${module}` }),
    );
    const byName = Object.fromEntries(
      changes.map((c) => [c.before!.name, { change: c.change, details: c.details }]),
    );

    expect(byName).toEqual({
      name: { change: "unchanged", details: [] },
      track: { change: "removed", details: [] },
      level: {
        change: "changed",
        details: ["signature: () => int → () => long", "native symbol: level()I → level()J"],
      },
      flush: { change: "changed", details: ["since: 21 → 26", "deprecated"] },
      setSize: { change: "changed", details: ["TypeScript name: setSize → setSize_long"] },
      Mode: { change: "changed", details: ["cases removed: SLOW"] },
    });
  });

  it("reports every symbol of a module that is gone as removed, with why", () => {
    const [change] = diffSymbols([used("name")], () => ({ missing: "no dev.orbit in the SDK" }));

    expect(change).toMatchObject({ change: "removed", details: ["no dev.orbit in the SDK"] });
  });

  it("compares whole modules: removed, changed, added and unchanged symbols", () => {
    const changes = diffModule(v1(), v2());
    const of = (change: string) =>
      changes
        .filter((c) => c.change === change)
        .map((c) => displayName((c.after ?? c.before)!))
        .sort();

    expect(of("removed")).toEqual(["Tracker.track", "Tracker.unused"]);
    expect(of("added")).toEqual(["Tracker.added", "Tracker.setSize"]);
    expect(of("changed")).toEqual([
      "Mode",
      "Tracker.flush",
      "Tracker.level",
      "Tracker.setSize_long",
    ]);
    expect(of("unchanged")).toEqual([
      "Tracker",
      "Tracker.VERSION",
      "Tracker.name",
      "new Tracker()",
    ]);
  });
});

describe("artifact identities", () => {
  it("names the modules whose artifacts differ from a lock, and those it does not record", () => {
    const locked = {
      "android/dev.orbit": { artifacts: ["android-sdk:35#a", "maven:dev.orbit:tracking:1.0.0#b"] },
      "android/android.os": { artifacts: ["android-sdk:35#a"] },
    };
    const found = {
      "android/dev.orbit": { artifacts: ["android-sdk:35#a", "maven:dev.orbit:tracking:1.1.0#c"] },
      "android/android.os": { artifacts: ["android-sdk:35#a"] },
      "android/android.app": { artifacts: ["android-sdk:35#a"] },
    };

    expect(compareArtifacts(locked, found)).toEqual([
      { module: "android/android.app", found: ["android-sdk:35#a"] },
      {
        module: "android/dev.orbit",
        locked: ["android-sdk:35#a", "maven:dev.orbit:tracking:1.0.0#b"],
        found: ["android-sdk:35#a", "maven:dev.orbit:tracking:1.1.0#c"],
      },
    ]);
  });
});

/** A module where two types get one member from an extension: the member shares its symbol. */
function shared(owners: string[], members: Record<string, string[]>): SdkModuleSchema {
  return {
    format: SCHEMA_FORMAT,
    platform: "ios",
    module: "Orbit",
    types: owners.map((name) => ({
      kind: "class" as const,
      name,
      native: name,
      symbol: `swift:s:5Orbit${name === "Beacon2" ? "Beacon" : name}C`,
      swift: { kind: "class" as const },
      methods: (members[name] ?? []).map((m) => ({
        name: m,
        params: [],
        returns: T("void"),
        symbol: `swift:s:5Orbit8SignableP${m}yyF`,
      })),
    })),
  };
}

describe("SDK diffs of shared and overloaded symbols", () => {
  it("does not take another type's member for one whose type still exists", () => {
    const before = shared(["Beacon", "Probe"], { Beacon: ["sign"], Probe: ["sign"] });
    const sign = sdkSymbols(before).find((s) => s.owner === "Beacon" && s.name === "sign")!;

    const dropped = shared(["Beacon", "Probe"], { Probe: ["sign"] });
    expect(diffSymbols([sign], () => dropped)[0]).toMatchObject({ change: "removed" });

    // A renamed type keeps its symbol: its members follow it.
    const renamed = shared(["Beacon2", "Probe"], { Beacon2: ["sign"], Probe: ["sign"] });
    expect(diffSymbols([sign], () => renamed)[0]).toMatchObject({
      change: "changed",
      details: ["declared by: Beacon → Beacon2"],
    });
  });

  it("matches constructors by signature, and takes each symbol of the new version once", () => {
    const tracker = (ctors: [string, string][]): SdkModuleSchema => ({
      ...v1(),
      types: [
        {
          kind: "class",
          name: "Tracker",
          native: "dev/orbit/Tracker",
          symbol: "jvm:dev/orbit/Tracker",
          constructors: ctors.map(([type, descriptor]) => ({
            params: [{ name: "a", type: T(type) }],
            symbol: jvm(`<init>(${descriptor})V`),
          })),
        },
      ],
    });
    const before = tracker([
      ["int", "I"],
      ["string", "Ljava/lang/String;"],
    ]);
    const after = tracker([["string", "Ljava/lang/String;"]]);

    const ctors = diffModule(before, after).filter(
      (c) => (c.before ?? c.after)!.kind === "constructor",
    );
    expect(ctors.map((c) => [c.change, displayName((c.before ?? c.after)!)])).toEqual([
      ["removed", "new Tracker(int)"],
      ["unchanged", "new Tracker(string)"],
    ]);

    const used = sdkSymbols(before).filter((s) => s.kind === "constructor");
    expect(diffSymbols(used, () => after).map((c) => c.change)).toEqual(["removed", "unchanged"]);
  });
});
