// JSX for native views (T48): a UIKit or Android view
// class is a tag, typed with the attributes its declarations derive by rule
// (sdk/view-rules.ts: children too, where its class inserts them), and
// `create`; anything else is a type error the editor shows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "../../src/index.ts";
import { createLucentProgram } from "../../src/program.ts";

const ios = sdkAvailable("ios");
const android = sdkAvailable("android");

/** The TypeScript errors of one platform file, as `TS<code>` with their messages' first line. */
function typeErrors(name: string, text: string, platform: "ios" | "android"): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-native-jsx-"));
  const file = path.join(dir, name);

  fs.writeFileSync(file, text);
  return createLucentProgram([file], undefined, platform)
    .diagnostics.filter((d) => d.code === "LUCENT9001")
    .map((d) => d.message.split("\n")[0]!);
}

describe("native view JSX types", () => {
  it.skipIf(!ios)("takes a UIKit view's writable properties, control events and children", () => {
    expect(
      typeErrors(
        "a.ios.lucent.tsx",
        `import { UILabel, UIStackView, UISwitch, type UIView } from "lucent:ios/UIKit";

export function Settings(title: string, enabled: boolean): UIView {
  return (
    <UIStackView spacing={8}>
      <UILabel text={title} numberOfLines={1n} alpha={0.5} />
      <UISwitch
        isOn={enabled}
        onValueChanged={(control) => {
          const on: boolean = control.isOn;
          void on;
        }}
      />
      <UILabel create={() => new UILabel({ origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } })} />
    </UIStackView>
  );
}
`,
        "ios",
      ),
    ).toEqual([]);
  });

  it.skipIf(!ios)("refuses what a UIKit view does not take", () => {
    const errors = typeErrors(
      "a.ios.lucent.tsx",
      `import { UIColor, UILabel, UIView } from "lucent:ios/UIKit";

export const unknown = <UILabel nope={1} />;
export const readOnly = <UILabel intrinsicContentSize={{ width: 1, height: 1 }} />;
export const method = <UILabel layoutSubviews={() => {}} />;
export const notAView = <UIColor />;
export const event = <UILabel onValueChanged={() => {}} />;
export const made = <UILabel create={() => new UIView({ origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } })} />;
`,
      "ios",
    );

    // One error a line: an attribute the class does not take (TS2769 where it has several
    // initializers, each tried), and a class that is no view.
    const refused = /^TS(2322|2769):/;
    expect(errors).toEqual([
      expect.stringMatching(refused),
      expect.stringMatching(refused),
      expect.stringMatching(refused),
      expect.stringMatching(/^TS2786:/),
      expect.stringMatching(refused),
      expect.stringMatching(refused),
    ]);
  });

  it.skipIf(!android)("takes an Android view's setters and listener events", () => {
    expect(
      typeErrors(
        "a.android.lucent.tsx",
        `import { CheckBox, TextView } from "lucent:android/android.widget";
import type { View } from "lucent:android/android.view";

export function Row(label: string): View {
  return (
    <CheckBox
      text={label}
      checked
      onCheckedChange={(_button, checked) => {
        const on: boolean = checked;
        void on;
      }}
      onClick={() => {}}
    />
  );
}

export const plain = <TextView text="hi" textSize={14} />;
`,
        "android",
      ),
    ).toEqual([]);
  });

  it.skipIf(!android)("gives children only to views that insert them", () => {
    const errors = typeErrors(
      "a.android.lucent.tsx",
      `import { LinearLayout, TextView } from "lucent:android/android.widget";

export const column = (
  <LinearLayout orientation={1}>
    <TextView text="a" />
  </LinearLayout>
);
export const label = (
  <TextView>
    <TextView text="a" />
  </TextView>
);
`,
      "android",
    );

    expect(errors).toEqual([expect.stringMatching(/^TS(2322|2769):/)]);
  });
});
