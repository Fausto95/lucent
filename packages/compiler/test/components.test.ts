import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable, type Target } from "../src/index.ts";

const ios = process.platform === "darwin" && sdkAvailable("ios");
const android = sdkAvailable("android");

/** A shared component returning each platform's label. */
const TITLE = `import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { UILabel } from "lucent:ios/UIKit";

type Props = { title: string; onPress?: () => void };

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

function compileApp(files: Record<string, string>, platforms: Target[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-components-"));
  const all = { "package.json": JSON.stringify({ name: "@acme/app" }), ...files };

  for (const [name, text] of Object.entries(all)) fs.writeFileSync(path.join(dir, name), text);

  const lucent = Object.keys(files).map((f) => path.join(dir, f));

  return compile(lucent, { platforms });
}

describe("components in compile results", () => {
  it.skipIf(!ios)(
    "describes a component and exports it as a native view, not a module function",
    () => {
      const r = compileApp({ "title.lucent.tsx": TITLE }, ["ios"]);

      expect(r.diagnostics).toEqual([]);
      expect(r.components?.map((c) => [c.id, c.platforms.ios?.root])).toEqual([
        ["@acme/app/title#Title", { module: "UIKit", name: "UILabel" }],
      ]);
      expect(r.components?.[0]?.events.map((e) => e.name)).toEqual(["onPress"]);

      const proxy = r.proxies.get("title") ?? "";

      expect(proxy).toContain("exports.shout = m.shout;");
      expect(proxy).toContain("exports.Title = lucentComponent(");
      expect(proxy).not.toContain("m.Title");

      const bindings = r.files.get("ios/lucent_bindings.cpp") ?? "";

      expect(bindings).toContain("shout");
      expect(bindings).not.toContain("Title");
    },
    180_000,
  );

  it.skipIf(!ios || !android)(
    "merges the platforms into one description",
    () => {
      const r = compileApp({ "title.lucent.tsx": TITLE }, ["ios", "android"]);

      expect(r.diagnostics).toEqual([]);
      expect(r.components).toHaveLength(1);
      expect(r.components![0]!.platforms).toEqual({
        ios: {
          root: { module: "UIKit", name: "UILabel" },
          artifact: `${r.components![0]!.registration}ComponentView`,
        },
        android: {
          root: { module: "android.widget", name: "TextView" },
          artifact: `dev.lucent.generated.${r.components![0]!.registration}Manager`,
        },
      });
    },
    300_000,
  );

  it.skipIf(!ios)(
    "reports what the analysis refuses and emits nothing",
    () => {
      const r = compileApp(
        {
          "title.lucent.tsx": TITLE.replace("onPress?: () => void", "onPress?: () => number"),
        },
        ["ios"],
      );

      expect(r.diagnostics.map((d) => d.code)).toEqual(["LUCENT3021"]);
      expect(r.ok).toBe(false);
      expect(r.files.size).toBe(0);
    },
    180_000,
  );
});
