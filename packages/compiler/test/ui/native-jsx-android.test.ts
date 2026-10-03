// A component of Android views written as JSX (T48), compiled: its views,
// props, listener events and children by rule, its glue compiled against
// the JDK's jni.h as the desktop JNI host builds glue. Mounting needs
// Android itself (the fixture's iOS side mounts in native-jsx-run.test.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable } from "../../src/index.ts";
import { glueErrors, jdk } from "../jni-harness.ts";
import { SETTINGS } from "./native-jsx-fixture.ts";

describe("a component of Android JSX", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it.skipIf(!sdkAvailable("android") || !jdk)(
    "makes its views, props, events and children by rule, in glue that compiles",
    () => {
      process.env.LUCENT_VIEWS = "fabric";
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-native-jsx-android-"));

      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
      for (const [f, text] of Object.entries(SETTINGS)) fs.writeFileSync(path.join(dir, f), text);

      const r = compile(
        Object.keys(SETTINGS).map((f) => path.join(dir, f)),
        { platforms: ["android"] },
      );
      const glue = r.files.get("android/m_settings.cpp") ?? "";

      expect(r.diagnostics).toEqual([]);
      // Made with the hosting view's Context; the text kept by an effect; the listener set,
      // and taken back with the mount; the children added at their indexes.
      expect(glue).toContain("lucent::jni::viewContext()");
      expect(glue).toMatch(/lucent::ui::effect\(/);
      expect(glue).toMatch(/"setOnCheckedChangeListener"[\s\S]*nullptr/);
      expect(glue.match(/"addView"/g)).toHaveLength(2);
      expect(glueErrors(r, dir, "android/m_settings.cpp")).toBe("");
    },
    600_000,
  );
});
