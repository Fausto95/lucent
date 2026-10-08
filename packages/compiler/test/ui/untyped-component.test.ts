// A one-file component checked where neither platform's SDK is installed (a
// Linux CI runner): its views are untyped, so it is no component and no
// function there. It's left out, as untyped platform code is, not refused as
// `any`; each platform's build compiles it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import type { SdkOptions } from "../../src/sdk/schema.ts";

const NO_SDKS: SdkOptions = {
  ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") },
  android: { sdkRoots: [path.join(os.tmpdir(), "no-such-android-sdk")] },
};

const BADGE = `import { PLATFORM } from "lucent:platform";
import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { UILabel } from "lucent:ios/UIKit";
import { effect } from "lucent:ui";

export function Badge(props: { label: string }) {
  if (PLATFORM === "ios") {
    const label = new UILabel();
    effect(() => {
      label.text = props.label;
    });
    return label;
  }
  const text = new TextView(appContext());
  effect(() => text.setText(props.label));
  return text;
}

export function size(): number {
  return 1;
}
`;

describe("a component whose platforms' SDKs are both missing", () => {
  it("is left out of a host build, which compiles the module's other exports", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-untyped-component-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
    fs.writeFileSync(path.join(dir, "badge.lucent.tsx"), BADGE);

    const r = compile([path.join(dir, "badge.lucent.tsx")], { platforms: ["host"], sdk: NO_SDKS });

    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect(r.proxies.get("badge")).toContain("exports.size");
    expect(r.proxies.get("badge")).not.toContain("Badge");
  });

  it("is left out of a host build as a split module's declaration, as lucent new view writes it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-untyped-component-"));
    const files = {
      "package.json": JSON.stringify({ name: "@acme/app" }),
      "card.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Props = { title: string };

export declare function Card(props: Props): UIView | View;
`,
      "card.ios.lucent.tsx": `import { UILabel, type UIView } from "lucent:ios/UIKit";
import type { Props } from "./card.lucent";

export function Card(props: Props): UIView {
  return <UILabel text={props.title} />;
}
`,
      "card.android.lucent.tsx": `import type { View } from "lucent:android/android.view";
import { TextView } from "lucent:android/android.widget";
import type { Props } from "./card.lucent";

export function Card(props: Props): View {
  return <TextView text={props.title} />;
}
`,
    };
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

    const r = compile(
      Object.keys(files)
        .filter((f) => f.includes(".lucent."))
        .map((f) => path.join(dir, f)),
      { platforms: ["host"], sdk: NO_SDKS },
    );

    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect([...r.proxies.keys()]).toEqual(["card"]);
  });
});
