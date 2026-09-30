import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { compile, inputsKey, sdkAvailable, writeNativePackage } from "../src/index.ts";

const ios = process.platform === "darwin" && sdkAvailable("ios");

/** A component whose iOS side returns a label (its Android side is not compiled here). */
const TITLE = `import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { UILabel } from "lucent:ios/UIKit";

type Props = { title: string; subtitle?: string | null; onPress?: () => void };

export function Title(props: Props) {
  if (PLATFORM === "ios") {
    const label = new UILabel();
    label.text = props.title;
    return label;
  }
  const text = new TextView(appContext());
  text.setText(props.title);
  return text;
}

export function shout(s: string): string {
  return s.toUpperCase();
}
`;

function compileApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fabric-views-"));
  const file = path.join(dir, "title.lucent.tsx");

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  fs.writeFileSync(file, TITLE);

  return { dir, result: compile([file], { platforms: ["ios"] }) };
}

const REGISTRATION = /^ios\/views\/LucentTitle_[0-9a-f]{12}\.h$/;

describe("components' Fabric sources in compiles", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it.skipIf(!ios)(
    "are left out unless LUCENT_VIEWS is fabric: components are only described",
    () => {
      const { result } = compileApp();

      expect(result.diagnostics).toEqual([]);
      expect(result.components?.map((c) => c.export)).toEqual(["Title"]);
      expect([...result.files.keys()].filter((f) => f.includes("/views/"))).toEqual([]);
      expect(result.proxies.get("title")).not.toContain("Title");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "join the native code and the module's proxy under LUCENT_VIEWS=fabric",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { dir, result } = compileApp();

      expect(result.diagnostics).toEqual([]);

      const views = [...result.files.keys()].filter((f) => f.includes("/views/")).sort();

      // The Fabric sources and registry, the component's mount, and the iOS host's view class.
      expect(views).toHaveLength(6);
      expect(
        views.some((f) => /^ios\/views\/LucentTitle_[0-9a-f]{12}ComponentView\.mm$/.test(f)),
      ).toBe(true);
      expect(views.some((f) => REGISTRATION.test(f))).toBe(true);
      // The mount, which runs the component's compiled setup.
      expect(views.some((f) => /^ios\/views\/LucentTitle_[0-9a-f]{12}_mount\.cpp$/.test(f))).toBe(
        true,
      );
      expect(views).toContain("ios/views/lucent_views.h");

      const proxy = result.proxies.get("title") ?? "";

      expect(proxy).toContain("exports.shout = m.shout;");
      expect(proxy).toContain('const { lucentComponent } = require("./_lucent/views.js");');
      expect(proxy).toMatch(
        /exports\.Title = lucentComponent\(\{\n {2}name: "LucentTitle_[0-9a-f]{12}",/,
      );

      const out = path.join(dir, "native");

      writeNativePackage(result, out);

      expect(fs.existsSync(path.join(out, "js/_lucent/views.js"))).toBe(true);
      expect(fs.existsSync(path.join(out, "cpp/generated/ios/views/lucent_views.cpp"))).toBe(true);
      expect(fs.existsSync(path.join(out, "cpp/rn/LucentViews.h"))).toBe(true);
    },
    180_000,
  );

  it("leave compiles without components alone, whatever LUCENT_VIEWS says", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fabric-views-"));
    const file = path.join(dir, "m.lucent.ts");

    fs.writeFileSync(file, "export function twice(n: number): number {\n  return n * 2;\n}\n");
    process.env.LUCENT_VIEWS = "paper";

    expect(compile([file]).diagnostics).toEqual([]);
  });

  it("key builds on the switch, so turning it on or off rebuilds", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fabric-views-"));
    const file = path.join(dir, "m.lucent.ts");

    fs.writeFileSync(file, "export const one = 1;\n");

    const off = inputsKey([file], path.join(dir, "native"));

    process.env.LUCENT_VIEWS = "fabric";

    expect(inputsKey([file], path.join(dir, "native"))).not.toBe(off);
  });
});
