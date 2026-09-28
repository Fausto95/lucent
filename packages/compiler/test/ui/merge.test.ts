import { describe, expect, it } from "vite-plus/test";
import type { ComponentDescription } from "../../src/ui/contract.ts";
import { mergeComponents } from "../../src/ui/merge.ts";

/** Meter as one platform's program describes it. */
function meter(
  platform: "ios" | "android",
  change: Partial<ComponentDescription> = {},
): ComponentDescription {
  const root =
    platform === "ios"
      ? { module: "UIKit", name: "UISlider" }
      : { module: "android.widget", name: "SeekBar" };
  const artifact =
    platform === "ios"
      ? "LucentMeter_df95023635f0ComponentView"
      : "dev.lucent.generated.LucentMeter_df95023635f0Manager";

  return {
    id: "@acme/app/meter#Meter",
    package: "@acme/app",
    module: "meter",
    export: "Meter",
    jsModule: "meter",
    registration: "LucentMeter_df95023635f0",
    props: [{ name: "value", type: { k: "number" }, optional: false }],
    events: [{ name: "onChange", slot: 0, optional: true, params: [], delivery: "discrete" }],
    commands: [{ name: "reset", params: [], result: { kind: "enqueue" } }],
    platforms: { [platform]: { root, artifact } },
    source: { file: `/app/meter.${platform}.lucent.tsx`, line: 3, column: 1 },
    ...change,
  };
}

describe("components across platforms", () => {
  it("merge into one description per identity, with each platform's root", () => {
    const r = mergeComponents([
      { target: "ios", components: [meter("ios")] },
      { target: "android", components: [meter("android")] },
    ]);

    expect(r.diagnostics).toEqual([]);
    expect(r.components).toHaveLength(1);
    expect(Object.keys(r.components[0]!.platforms)).toEqual(["ios", "android"]);
    expect(r.components[0]!.platforms.android!.root).toEqual({
      module: "android.widget",
      name: "SeekBar",
    });
  });

  it("refuse a public contract that differs between platforms", () => {
    const r = mergeComponents([
      { target: "ios", components: [meter("ios")] },
      {
        target: "android",
        components: [
          meter("android", {
            props: [{ name: "value", type: { k: "string" }, optional: false }],
            commands: [],
          }),
        ],
      },
    ]);

    expect(r.diagnostics.map((d) => [d.code, d.message, d.file])).toEqual([
      [
        "LUCENT3023",
        "`Meter` has different props on ios and android: a component's props, events and commands are the same on every platform",
        "/app/meter.android.lucent.tsx",
      ],
      [
        "LUCENT3023",
        "`Meter` has different commands on ios and android: a component's props, events and commands are the same on every platform",
        "/app/meter.android.lucent.tsx",
      ],
    ]);
  });

  it("refuse a component that is one on some platforms only", () => {
    const r = mergeComponents([
      { target: "ios", components: [meter("ios")] },
      { target: "android", components: [] },
    ]);

    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "`Meter` is a component on ios but not on android: return a view on every platform",
    ]);
  });

  it("keep the host's descriptions only when no platform was compiled", () => {
    const host = { ...meter("ios"), platforms: {} };

    expect(mergeComponents([{ target: "host", components: [host] }]).components).toEqual([host]);
    expect(
      mergeComponents([
        { target: "host", components: [] },
        { target: "ios", components: [meter("ios")] },
      ]).diagnostics,
    ).toEqual([]);
  });
});
