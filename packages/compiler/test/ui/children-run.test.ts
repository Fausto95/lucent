// React children in the iOS host: the Card fixture's generated component
// view (and two more), driven on Mac Catalyst as React Native's mounting
// manager drives it, against its prebuilt view classes
// (children_run_test.mm drives it).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { CARD, IOS_HOSTED } from "./card-fixture.ts";
import { catalystObjects, macosSdk, quickjsSources } from "./mount-harness.ts";
import { catalystToolchain, reactCommon } from "./react-native-headers.ts";

const toolchain = catalystToolchain();
const ios = process.platform === "darwin" && sdkAvailable("ios");

/** Every step of the driver, in order. */
const EXPECTED = [
  "before mount: 11 in none, 12 in none",
  "mounted: slot holds 11 12, in the card: yes, clips: yes",
  "laid out: 11 at 10,10 of the host",
  "moved natively: 11 at 10,10 of the host",
  "reordered: 12 11",
  "inserted, removed: 12 13, 11 in none",
  "recycled: slot none, old slot holds nothing",
  "remounted: new slot holds 14",
  "pocket: slot holds 15, in its view: no",
  "label: 16 in none, content holds 0 views",
  "label: 16 unmounted in none",
];

/**
 * The host's reports of where the card's slot is, in its content box
 * (left, top, right, bottom): none while the slot fills the box, one when
 * a native move shifts it.
 */
const SLOT_REPORTS = ["slot report 1: 5,5,0,0 posted"];

/** The slot's LUCENT_SIZING lines of `stderr`, without their time and tag. */
const slotReports = (stderr: string) =>
  stderr
    .split("\n")
    .map((line) => /LUCENT_SIZING [\d.]+ ms -?\d+ (slot .*)$/.exec(line)?.[1])
    .filter((line) => line !== undefined);

describe("React children in the iOS host", () => {
  it.skipIf(!toolchain || !ios)(
    "go in the mount's slot in React Native's order, at Yoga's frames, and never elsewhere",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-children-run-"));
      const files = { ...CARD, ...IOS_HOSTED };

      delete files["card.android.lucent.tsx"];

      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
      for (const [name, text] of Object.entries(files))
        fs.writeFileSync(path.join(dir, name), text);

      const result = compile(
        Object.keys(files).map((f) => path.join(dir, f)),
        { platforms: ["ios"] },
      );

      expect(result.diagnostics).toEqual([]);

      const out = path.join(dir, "out");
      for (const [f, text] of result.files) {
        fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
        fs.writeFileSync(path.join(out, f), text);
      }

      const registration = (name: string) =>
        result.components!.find((c) => c.export === name)!.registration;
      const driver = path.join(out, "ios/driver.mm");

      fs.writeFileSync(
        driver,
        fs
          .readFileSync(path.join(import.meta.dirname, "children_run_test.mm"), "utf8")
          .replaceAll("CARD", registration("Card"))
          .replaceAll("POCKET", registration("Pocket"))
          .replaceAll("LABEL", registration("Label")),
      );

      // Mac Catalyst's UIKit lives in the macOS SDK's iOS support.
      const support = path.join(macosSdk(), "System/iOSSupport");
      const args = [
        "-fobjc-arc",
        "-iframework",
        path.join(support, "System/Library/Frameworks"),
        `-F${path.join(support, "System/Library/Frameworks")}`,
        "-isystem",
        path.join(support, "usr/include"),
        "-isystem",
        path.join(reactCommon(), "react/utils/platform/ios"),
        // The app builds Lucent's modules without -Werror.
        "-Wno-unused-variable",
      ];

      // The runtime, its JSI boundary, the host, the module and its views.
      const cpp = path.join(runtimeDir(), "cpp");
      const rn = path.join(cpp, "rn");
      const sources = [
        ...fs
          .readdirSync(path.join(cpp, "lucent"))
          .filter((f) => f.endsWith(".cpp"))
          .map((f) => path.join(cpp, "lucent", f)),
        path.join(cpp, "lucent/jsi/host.cpp"),
        path.join(cpp, "lucent/jsi/convert.cpp"),
        path.join(cpp, "lucent/platform/ios.mm"),
        path.join(cpp, "lucent/platform/ios_ui.mm"),
        path.join(rn, "LucentViewRequests.cpp"),
        ...fs
          .readdirSync(rn)
          .filter((f) => f.endsWith(".mm"))
          .map((f) => path.join(rn, f)),
        // The JSI boundary registers the program's modules (lucent_bindings.cpp, lucent_identity.cpp).
        ...[...result.files.keys()]
          .filter((f) => /\.(cpp|mm)$/.test(f))
          .map((f) => path.join(out, f)),
        driver,
      ];

      const binary = path.join(dir, "children_run");
      const objects = catalystObjects(
        dir,
        args,
        [...sources, ...quickjsSources()],
        path.join(out, "ios"),
      );
      const link = spawnSync(
        toolchain!.command,
        [
          ...toolchain!.args,
          ...args,
          ...objects,
          "-framework",
          "UIKit",
          "-framework",
          "Foundation",
          "-framework",
          "CoreFoundation",
          "-framework",
          "CoreGraphics",
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );

      expect(link.stderr).toBe("");

      const run = spawnSync(binary, [], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, LUCENT_SIZING_TRACE: "1" },
      });

      expect(run.stdout.trim().split("\n")).toEqual(EXPECTED);
      expect(slotReports(run.stderr)).toEqual(SLOT_REPORTS);
      expect(run.status).toBe(0);
      expect(run.stderr).toContain(
        `[lucent] ${registration("Pocket")}'s setup did not put its slot in the view it returned: its React children do not show`,
      );
      expect(run.stderr).toContain(
        `[lucent] ${registration("Label")} takes no React children: React Native gave it 1, which it does not show`,
      );

      fs.rmSync(dir, { recursive: true, force: true });
    },
    900_000,
  );
});
