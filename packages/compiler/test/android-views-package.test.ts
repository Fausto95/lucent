import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { compile, writeNativePackage } from "../src/index.ts";
import type { ComponentDescription } from "../src/ui/contract.ts";
import { CAPTION, GAUGE, components } from "./ui/views-fixture.ts";

/** The fixture's components, as if Android implemented Caption and Gauge (not Picker). */
function androidComponents(): ComponentDescription[] {
  return components().map((c) =>
    c.registration === CAPTION || c.registration === GAUGE
      ? {
          ...c,
          platforms: {
            ...c.platforms,
            android: {
              root: { module: "android.widget", name: "TextView" },
              artifact: `dev.lucent.generated.${c.registration}Manager`,
            },
          },
        }
      : c,
  );
}

/** The native package of a one-function program exporting the fixture's components. */
function write(
  components = androidComponents(),
  options: Parameters<typeof writeNativePackage>[2] = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-views-"));
  const src = path.join(dir, "a.lucent.ts");

  fs.writeFileSync(src, "export function one(): number { return 1; }\n");

  const out = path.join(dir, "native");

  writeNativePackage({ ...compile([src]), components }, out, options);

  return out;
}

const read = (out: string, file: string) => fs.readFileSync(path.join(out, file), "utf8");

/** The Android part of the package's autolinking configuration. */
function autolinking(out: string): Record<string, unknown> {
  const file = path.join(out, "react-native.config.js");
  const config = createRequire(file)(file) as {
    dependency: { platforms: { android: Record<string, unknown> } };
  };

  return config.dependency.platforms.android;
}

const JAVA = "android/src/main/java/dev/lucent";
const DESCRIPTORS = "android/include/react/renderer/components/lucentnative/ComponentDescriptors.h";

describe("Android view registration in the native package", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it("gives each Android component a manager, listed for the package, under LUCENT_VIEWS=fabric", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const out = write();

    for (const registration of [CAPTION, GAUGE]) {
      const manager = read(out, `${JAVA}/generated/${registration}Manager.java`);

      expect(manager).toContain("package dev.lucent.generated;");
      expect(manager).toContain(
        `public final class ${registration}Manager extends LucentViewManager`,
      );
      expect(manager).toContain(`super("${registration}");`);
    }

    const list = read(out, `${JAVA}/LucentViewManagers.java`);

    expect(list).toContain(`new dev.lucent.generated.${CAPTION}Manager()`);
    expect(list).toContain(`new dev.lucent.generated.${GAUGE}Manager()`);
    expect(list).not.toContain("Picker");
  });

  it("registers each Android component's descriptor through autolinking", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const out = write();

    expect(autolinking(out).componentDescriptors).toEqual([
      `lucent::views::HostDescriptor<lucent::views::${CAPTION}::ComponentDescriptor>`,
      `lucent::views::HostDescriptor<lucent::views::${GAUGE}::ComponentDescriptor>`,
    ]);

    const descriptors = read(out, DESCRIPTORS);

    expect(descriptors).toContain('#include "LucentViewsAndroid.h"');
    expect(descriptors).toContain(`#include "views/${CAPTION}.h"`);
    expect(descriptors).toContain(`#include "views/${GAUGE}.h"`);
    expect(descriptors).not.toContain("Picker");
  });

  it("registers every described component while Android's build is deferred", () => {
    process.env.LUCENT_VIEWS = "fabric";

    // After expo prebuild, only iOS was compiled: its descriptions name no Android side. The
    // app's first Gradle build reads the autolinking config before its lucentBuild compiles
    // Android, and every component is one on each platform, so each is registered now.
    const ios = components().filter((c) => c.platforms.ios);
    const out = write(
      ios.map((c) => ({ ...c, platforms: { ios: c.platforms.ios } })),
      { androidDeferred: true },
    );
    const registrations = ios.map((c) => c.registration).sort();

    expect(registrations.length).toBeGreaterThan(0);
    expect(autolinking(out).componentDescriptors).toEqual(
      registrations.map(
        (r) => `lucent::views::HostDescriptor<lucent::views::${r}::ComponentDescriptor>`,
      ),
    );

    const descriptors = read(out, DESCRIPTORS);

    for (const r of registrations) expect(descriptors).toContain(`#include "views/${r}.h"`);
  });

  it("lets React Native recycle component views when the app turns recycling on", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const manager = read(write(), `${JAVA}/LucentViewManager.java`);

    // A manager's views are pooled only if it asks, and enableViewRecycling is on.
    expect(manager).toMatch(
      /protected LucentViewManager\(String name, boolean takesChildren\) \{[^}]*setupViewRecycling\(\);[^}]*\}/,
    );
  });

  it("lets a component's content draw outside its view, as a React Native view's does", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const shell = read(write(), `${JAVA}/LucentHostView.java`);

    // React Native's default overflow is visible, and the iOS host's content is not clipped.
    expect(shell).toMatch(
      /public LucentHostView\(Context context, String name, boolean takesChildren\) \{[^}]*setClipChildren\(false\);\s*setClipToPadding\(false\);[^}]*\}/,
    );
  });

  it("registers no views while the switch is off", () => {
    const out = write();

    expect(fs.existsSync(path.join(out, `${JAVA}/generated/${GAUGE}Manager.java`))).toBe(false);
    expect(read(out, `${JAVA}/LucentViewManagers.java`)).toContain("Collections.emptyList()");
    expect(autolinking(out).componentDescriptors).toBeUndefined();
    expect(fs.existsSync(path.join(out, DESCRIPTORS))).toBe(false);
  });
});
