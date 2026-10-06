// What a component of native view JSX (T48) cannot do, and how Lucent says
// so: LUCENT3025 for native JSX it cannot make, with what to do instead;
// an attribute the rules refuse, explained; the main thread's rules
// (LUCENT3022), which an attribute's code keeps like any setup code; the
// shapes a child that comes and goes (T49) takes.
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
    "title.lucent.ts": `import type { UIView } from "lucent:ios/UIKit";\nimport type { View } from "lucent:android/android.view";\n\nexport type Tag = { id: string; name: string };\n\nexport type Props = { title: string; tags: Tag[] };\n\nexport declare function Title(props: Props): UIView | View;\n`,
    [`title.${platform}.lucent.tsx`]: `${imports}\nimport type { ${root} } from "${from}";\nimport type { Props } from "./title.lucent";\n\nexport function Title(props: Props): ${root} {\n${code}\n}\n`,
  };

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: [platform] },
  ).diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
    fix: d.fix,
    ...(d.quickFix ? { quickFix: d.quickFix } : {}),
  }));
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
        quickFix: {
          title: "Read props.title in the attribute",
          edits: [{ start: expect.any(Number), length: "title".length, text: "props.title" }],
        },
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

  const stack = (child: string) =>
    `  return (\n    <UIStackView>\n      ${child}\n    </UIStackView>\n  );`;
  const UIKIT = 'import { UILabel, UIStackView } from "lucent:ios/UIKit";';
  const refused = (child: string) => diagnostics("ios", UIKIT, stack(child));
  const says = (message: string) => [
    expect.objectContaining({ code: "LUCENT3025", message: expect.stringContaining(message) }),
  ];

  it.skipIf(!ios)("asks a list's element for its key", () => {
    expect(refused("{props.tags.map((tag) => <UILabel text={tag.name} />)}")).toEqual(
      says("a list's element has a `key` saying which item it is"),
    );
  });

  it.skipIf(!ios)("refuses a list's index", () => {
    expect(refused("{props.tags.map((tag, i) => <UILabel key={tag.id} text={`${i}`} />)}")).toEqual(
      says("a list's item has no index"),
    );
  });

  it.skipIf(!ios)("refuses a list's callback giving no element", () => {
    expect(
      refused('{props.tags.map((tag) => (tag.id === "" ? null : <UILabel key={tag.id} />))}'),
    ).toEqual(says("a list's callback returns one element of a native view"));
  });

  it.skipIf(!ios)("refuses a key outside a list", () => {
    expect(refused('<UILabel key="a" text={props.title} />')).toEqual(
      says("`key` is for the element a list's callback returns"),
    );
  });

  it.skipIf(!ios)("refuses a list inside a condition", () => {
    expect(
      refused(
        "{props.title !== '' && props.tags.map((tag) => <UILabel key={tag.id} text={tag.name} />)}",
      ),
    ).toEqual(says("a list is a child of its own"));
  });

  it.skipIf(!ios)("says which children come and go", () => {
    expect(refused('{[<UILabel text="a" />]}')).toEqual(
      says("a native view's child that comes and goes is"),
    );
  });

  const flex = (code: string) =>
    diagnostics(
      "ios",
      'import { Flex } from "lucent:ui";\nimport { UILabel, UIStackView } from "lucent:ios/UIKit";',
      `  return (\n    ${code}\n  );`,
    );

  it.skipIf(!ios)("places only a Flex's children with `layout`", () => {
    expect(
      flex('<UIStackView><UILabel text="a" layout={{ flexGrow: 1 }} /></UIStackView>'),
    ).toEqual(says("`layout` places a Flex's child: this element's parent is no Flex"));
  });

  it.skipIf(!ios)("takes a Flex's style as an object literal", () => {
    expect(
      flex(
        "<Flex style={props.title === '' ? { gap: 1 } : { gap: 2 }}><UILabel text=\"a\" /></Flex>",
      ),
    ).toEqual(says("`style` is an object literal"));
  });

  it.skipIf(!ios)("refuses a key a Flex's style and layout both set", () => {
    expect(
      flex(
        '<Flex><Flex style={{ width: 10 }} layout={{ width: 20 }}><UILabel text="a" /></Flex></Flex>',
      ),
    ).toEqual(says("width is set by both `style` and `layout`"));
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
