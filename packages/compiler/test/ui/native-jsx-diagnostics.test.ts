// What a component of native view JSX (T48) cannot do, and how Lucent says
// so: LUCENT3025 for native JSX it cannot make, with what to do instead;
// an attribute the rules refuse, explained; the main thread's rules
// (LUCENT3022), which an attribute's code keeps like any setup code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable } from "../../src/index.ts";

const ios = sdkAvailable("ios");
const android = sdkAvailable("android");

/** The diagnostics of a one-file component of `platform`, `code` its body. */
function diagnostics(platform: "ios" | "android", imports: string, code: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-native-jsx-diagnostics-"));
  const root = platform === "ios" ? "UIView" : "View";
  const from = platform === "ios" ? "lucent:ios/UIKit" : "lucent:android/android.view";
  const files = {
    "title.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";\nimport type { View } from "lucent:android/android.view";\n\nexport type Props = { title: string };\n\nexport declare function Title(props: Props): UIView | View;\n`,
    [`title.${platform}.lucent.tsx`]: `${imports}\nimport type { ${root} } from "${from}";\nimport type { Props } from "./title.lucent";\n\nexport function Title(props: Props): ${root} {\n${code}\n}\n`,
  };

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: [platform] },
  ).diagnostics.map((d) => ({ code: d.code, message: d.message, fix: d.fix }));
}

describe("native view JSX diagnostics", () => {
  beforeEach(() => {
    process.env.LUCENT_VIEWS = "fabric";
  });

  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it.skipIf(!ios)("says to return native JSX, not keep it", () => {
    expect(
      diagnostics(
        "ios",
        'import { UILabel } from "lucent:ios/UIKit";',
        "  const label = <UILabel text={props.title} />;\n  return label;",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "LUCENT3025",
        message: expect.stringContaining("JSX of native views is what a component returns"),
      }),
    ]);
  });

  it.skipIf(!ios)("refuses an attribute reading a copy setup made of a prop", () => {
    expect(
      diagnostics(
        "ios",
        'import { UILabel } from "lucent:ios/UIKit";',
        "  const title = props.title;\n  return <UILabel text={title} />;",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "LUCENT3025",
        message: expect.stringContaining(
          "`title` is props.title as setup first read it: the attribute would never change",
        ),
        fix: "read props.title in the attribute, which keeps it up to date",
      }),
    ]);
  });

  it.skipIf(!ios)("keeps the main thread's rules in attributes", () => {
    expect(
      diagnostics(
        "ios",
        'import { UILabel } from "lucent:ios/UIKit";\n\nlet count = 0;\n\nfunction next(): number {\n  count++;\n  return count;\n}',
        "  return <UILabel text={`${props.title} ${next()}`} />;",
      ),
    ).toEqual([expect.objectContaining({ code: "LUCENT3022" })]);
  });

  it.skipIf(!ios)("refuses a SwiftUI view among native views", () => {
    expect(
      diagnostics(
        "ios",
        'import { UIStackView } from "lucent:ios/UIKit";\nimport { Text } from "lucent:swiftui";',
        "  return (\n    <UIStackView>\n      <Text>{props.title}</Text>\n    </UIStackView>\n  );",
      ),
    ).toEqual([
      expect.objectContaining({
        code: expect.stringMatching(/^LUCENT(3025|9001)$/),
      }),
    ]);
  });

  it.skipIf(!android)("explains an attribute its rules leave out", () => {
    expect(
      diagnostics(
        "android",
        'import { AutoCompleteTextView } from "lucent:android/android.widget";',
        "  return <AutoCompleteTextView adapter={null} />;",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "LUCENT9001",
        message: expect.stringContaining(
          "<AutoCompleteTextView> does not take adapter: setAdapter is generic",
        ),
        fix: "call it in setup code, on the view made with create={() => new AutoCompleteTextView(…)}",
      }),
    ]);
  });
});
