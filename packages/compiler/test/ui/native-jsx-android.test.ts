// A component of Android views written as JSX (T48), compiled: its views,
// props, listener events and children by rule, its glue compiled against
// the JDK's jni.h as the desktop JNI host builds glue. Mounting needs
// Android itself (the fixture's iOS side mounts in native-jsx-run.test.ts);
// so do children that come and go (T49, native-jsx-flow-run.test.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable } from "../../src/index.ts";
import { glueErrors, jdk } from "../jni-harness.ts";
import { ROWS } from "./native-jsx-flow-fixture.ts";
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
  it.skipIf(!sdkAvailable("android") || !jdk)(
    "adds and removes children by condition and key, in glue that compiles",
    () => {
      process.env.LUCENT_VIEWS = "fabric";
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-native-jsx-flow-android-"));
      // An item's event too: registered again when its item changes.
      const files = {
        ...ROWS,
        "rows.android.lucent.tsx": ROWS["rows.android.lucent.tsx"].replace(
          "<TextView key={row.id} text={row.title} />",
          "<TextView key={row.id} text={row.title} onClick={() => console.log(row.title)} />",
        ),
      };

      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
      for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);

      const r = compile(
        Object.keys(files).map((f) => path.join(dir, f)),
        { platforms: ["android"] },
      );
      const glue = r.files.get("android/m_rows.cpp") ?? "";

      expect(r.diagnostics).toEqual([]);
      expect(glue).toContain("lucent::ui::KeyedList<");
      expect(glue.match(/lucent::ui::branch</g)).toHaveLength(2);
      expect(glue).toMatch(/"removeView"/);
      expect(glue).toMatch(/"setOnClickListener"/);
      expect(glueErrors(r, dir, "android/m_rows.cpp")).toBe("");
    },
    600_000,
  );
});
