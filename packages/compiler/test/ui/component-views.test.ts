/**
 * A component's ref as a module function's argument (T124, decision 0120):
 * lucent:ui's ComponentView crosses from JavaScript alone, as the mount the
 * ref names, and lucent:ios's and lucent:android's viewOf read its root
 * view inside main(). Compiled against a schema set (iOS) and stand-ins
 * for android.jar, on any machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { fakeAndroid } from "../fake-android.ts";
import { schemaSet } from "../schema-set.ts";

const DECLARATION = `import type { ComponentView } from "lucent:ui";

export declare function alphaOf(view: ComponentView): Promise<number>;
`;

/** `files` in a fresh directory, compiled for `platform` against stand-ins of its SDK. */
function compiled(platform: "ios" | "android", files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-component-views-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const sources = Object.keys(files).map((f) => path.join(dir, f));

  if (platform === "android") {
    const android = fakeAndroid(dir, {
      "android/content/Context.java":
        "package android.content;\npublic abstract class Context {}\n",
      "android/view/View.java":
        "package android.view;\npublic class View {\n  public View(android.content.Context c) {}\n  public float getAlpha() { return 1; }\n}\n",
    });
    return android
      ? compile(sources, { platforms: ["android"], sdk: { android: { jars: android.bind } } })
      : undefined;
  }

  return compile(sources, {
    platforms: ["ios"],
    sdk: {
      schemas: schemaSet([
        {
          module: "UIKit",
          header: "UIKit/UIKit.h",
          types: [
            {
              kind: "class",
              name: "UIView",
              native: "UIView",
              mainActor: true,
              constructors: [{ params: [], selector: "init" }],
              properties: [{ name: "alpha", type: "double", setter: "setAlpha:" }],
            },
          ],
        },
      ]),
      cacheDir: path.join(dir, "cache"),
      ios: { xcrun: path.join(dir, "no-xcrun") },
    },
  });
}

const messages = (r: ReturnType<typeof compile> | undefined) =>
  (r?.diagnostics ?? []).map((d) => [d.code, d.message]);

describe("a component's view as a module function's argument", () => {
  it("crosses as the mount its ref names, and viewOf reads its root inside main() on iOS", () => {
    const r = compiled("ios", {
      "alpha.lucent.ts": DECLARATION,
      "alpha.ios.lucent.ts": `import { viewOf } from "lucent:ios";
import type { UIView } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
import type { ComponentView } from "lucent:ui";

export async function alphaOf(view: ComponentView): Promise<number> {
  return main(() => {
    const root: UIView = viewOf(view);
    return root.alpha;
  });
}
`,
    });
    expect(messages(r)).toEqual([]);

    const unit = r!.files.get("ios/m_alpha.mm") ?? r!.files.get("ios/m_alpha.cpp") ?? "";
    expect(unit).toContain("lucent::ui::viewOf(");
    expect(r!.files.get("ios/lucent_bindings.cpp")).toContain(
      "Convert<lucent::ui::ComponentView>::fromJs(",
    );
  });

  it("is read on Android's main thread as the platform's View", () => {
    const r = compiled("android", {
      "alpha.lucent.ts": DECLARATION,
      "alpha.android.lucent.ts": `import { viewOf } from "lucent:android";
import type { View } from "lucent:android/android.view";
import { main } from "lucent:thread";
import type { ComponentView } from "lucent:ui";

export async function alphaOf(view: ComponentView): Promise<number> {
  return main(() => {
    const root: View = viewOf(view);
    return root.getAlpha();
  });
}
`,
    });
    // Without a JDK for the stand-ins, nothing to compile against.
    if (!r) return;
    expect(messages(r)).toEqual([]);
    expect(r.files.get("android/m_alpha.cpp")).toContain("lucent::ui::viewOf(");
  });

  it("refuses viewOf outside main(), and a ComponentView going back to JavaScript", () => {
    const r = compiled("ios", {
      "alpha.lucent.ts": `import type { ComponentView } from "lucent:ui";

export declare function alpha(view: ComponentView): number;
export declare function same(view: ComponentView): ComponentView;
`,
      "alpha.ios.lucent.ts": `import { viewOf } from "lucent:ios";
import type { UIView } from "lucent:ios/UIKit";
import type { ComponentView } from "lucent:ui";

export function alpha(view: ComponentView): number {
  const root: UIView = viewOf(view);
  return root.alpha;
}

export function same(view: ComponentView): ComponentView {
  return view;
}
`,
    });
    const found = messages(r);
    expect(found).toContainEqual([
      "LUCENT3006",
      "viewOf reads a component's view, which is the main thread's: call it inside main(() => …) from lucent:thread",
    ]);
    expect(found).toContainEqual([
      "LUCENT2006",
      "a ComponentView can only be passed from JavaScript to Lucent, as a component's ref: JavaScript has the ref already",
    ]);
  });
});
