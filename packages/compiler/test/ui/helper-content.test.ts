/**
 * Helper views taking bound signals and children (T123). A bound prop
 * (`on: Bound<boolean>`) is a Swift `Binding` or a Kotlin value and its
 * change callback, which its user binds with `bind(signal)` or gives a
 * bound prop of its own; the helper's view shows it and changes it.
 * Children (`children: Content`, Compose's `Shown`) are a content closure
 * of the helper's view, which its user's element holds and the helper
 * shows where it reads `props.children`. Compose bodies build against
 * stand-ins for android.jar where the Android SDK is missing, SwiftUI ones
 * against the miniature SwiftUI where Xcode is (whose Swift type-checks).
 */
import { describe, expect, it } from "vite-plus/test";
import { buildSwiftUI, miniSwiftErrors, miniSwiftUI } from "./mini-swiftui.ts";
import { build, composeBuilds, diagnostics, generated } from "./toolkit-build.ts";

const DECLARATION = (view: string, from: string) => `import type { ${view} } from "${from}";

export type Props = { title: string; on: boolean };

export declare function Screen(props: Props): ${view};
`;

describe.skipIf(!composeBuilds())("a Compose helper view", () => {
  it("takes a bound signal as its value and change callback", () => {
    const { result } = build(
      {
        "screen.lucent.ts": DECLARATION("View", "lucent:android/android.view"),
        "screen.android.lucent.tsx": `import { BasicText, Column, Row, Switch } from "lucent:compose";
import { type Bound, bind, signal } from "lucent:ui";
import type { Props } from "./screen.lucent";

function Setting(props: { label: string; on: Bound<boolean> }) {
  return (
    <Row>
      <BasicText text={props.label} />
      <Switch checked={props.on} />
    </Row>
  );
}

function Group(props: { on: Bound<boolean> }) {
  return (
    <Column>
      <Setting label={"inner"} on={props.on} />
    </Column>
  );
}

export function Screen(props: Props) {
  const on = signal(false);

  return (
    <Column>
      <Setting label={props.title} on={bind(on)} />
      <Group on={bind(on)} />
    </Column>
  );
}
`,
      },
      "android",
    );

    expect(diagnostics(result)).toEqual([]);

    const kotlin = generated(result, /^dev\/lucent\/compose\/.*\.kt$/);

    expect(kotlin).toMatch(
      /fun \w+_Setting\(label\d+: String, on: Boolean, onChanged: \(Boolean\) -> Unit\) \{/,
    );
    expect(kotlin).toContain("Switch(checked = on, onCheckedChange = onChanged)");
    expect(kotlin).toMatch(
      /_Setting\(label\d+ = lucent\.\w+\.value, on = lucent\.(\w+)\.value, onChanged = \{ value -> lucent\.\w+\(value\) \}\)/,
    );
    // A bound prop passed on: the value and change its user was given.
    expect(kotlin).toMatch(/_Setting\(label\d+ = label\d+, on = on, onChanged = onChanged\)/);
  });

  it("takes children as its content lambda", () => {
    const { result } = build(
      {
        "screen.lucent.ts": DECLARATION("View", "lucent:android/android.view"),
        "screen.android.lucent.tsx": `import { BasicText, Column, dp, Modifier, Row, type Shown } from "lucent:compose";
import type { Props } from "./screen.lucent";

function Card(props: { title: string; children: Shown }) {
  return (
    <Column modifier={Modifier.padding(dp(8))}>
      <BasicText text={props.title} />
      {props.children}
    </Column>
  );
}

function Pair(props: { children: Shown }) {
  return <Row>{props.children}</Row>;
}

export function Screen(props: Props) {
  return (
    <Column>
      <Card title={props.title}>
        <BasicText text="a" />
        {props.on ? <BasicText text="on" /> : null}
      </Card>
      <Pair>
        <Card title={"inner"}>
          <BasicText text="x" />
        </Card>
      </Pair>
    </Column>
  );
}
`,
      },
      "android",
    );

    expect(diagnostics(result)).toEqual([]);

    const kotlin = generated(result, /^dev\/lucent\/compose\/.*\.kt$/);

    expect(kotlin).toMatch(
      /fun \w+_Card\(title\d+: String, content: @Composable \(\) -> Unit\) \{/,
    );
    expect(kotlin).toMatch(/BasicText\(text = title\d+\)\n\s+content\(\)/);
    expect(kotlin).toMatch(
      /fun \w+_Pair\(content: @Composable \(\) -> Unit\) \{\n\s+Row \{ content\(\) \}/,
    );
    expect(kotlin).toMatch(
      /_Card\(title\d+ = lucent\.\w+\.value\) \{\n\s+BasicText\(text = "a"\)\n\s+if \(/,
    );
    expect(kotlin).toMatch(
      /_Pair \{ \w+_Card\(title\d+ = lucent\.\w+\.value\) \{ BasicText\(text = "x"\) \} \}/,
    );
  });

  // Children to a helper that takes none is TypeScript's error (TS2322) first.
  it("refuses content by another name than children", () => {
    const refused = (helper: string, use: string) =>
      diagnostics(
        build(
          {
            "screen.lucent.ts": DECLARATION("View", "lucent:android/android.view"),
            "screen.android.lucent.tsx": `import { BasicText, Column, type Shown } from "lucent:compose";
import type { Props } from "./screen.lucent";

${helper}

export function Screen(props: Props) {
  return <Column>${use}</Column>;
}
`,
          },
          "android",
        ).result,
      );

    expect(
      refused(
        "function Line(props: { body: Shown }) {\n  return <Column>{props.body}</Column>;\n}",
        "<Line body={null} />",
      ),
    ).toContain(
      "LUCENT3024 the helper view `Line` takes content as its children: `children`, not `body`",
    );
  });
});

const mini = miniSwiftUI();

describe.skipIf(!mini)("a SwiftUI helper view", () => {
  it("takes a bound signal as a Binding, and children as its content", () => {
    const built = buildSwiftUI(mini!, {
      "screen.lucent.ts": DECLARATION("View", "lucent:swiftui"),
      "screen.ios.lucent.tsx": `import { Content, HStack, Text, Toggle, VStack } from "lucent:swiftui";
import { type Bound, bind, signal } from "lucent:ui";
import type { Props } from "./screen.lucent";

function Setting(props: { label: string; on: Bound<boolean> }) {
  return <Toggle isOn={props.on}>{props.label}</Toggle>;
}

function Card(props: { title: string; on: Bound<boolean>; children: Content }) {
  return (
    <VStack padding={8}>
      <Setting label={props.title} on={props.on} />
      {props.children}
    </VStack>
  );
}

export function Screen(props: Props) {
  const on = signal(false);

  return (
    <VStack>
      <Card title={props.title} on={bind(on)}>
        <Text>a</Text>
        {props.on ? <Text>on</Text> : null}
      </Card>
      <HStack>
        <Setting label={"b"} on={bind(on)} />
      </HStack>
    </VStack>
  );
}
`,
    });

    expect(built.result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);

    const swift =
      [...built.result.files].find(
        ([f]) => f.startsWith("ios/views/") && f.endsWith(".swift"),
      )?.[1] ?? "";

    expect(swift).toMatch(
      /struct ScreenView_Card<Content: View>: View \{\n {2}let \w+\d+: String\n {2}let on: Binding<Bool>\n {2}@ViewBuilder let content: \(\) -> Content\n/,
    );
    expect(swift).toMatch(/ScreenView_Setting\(label\d+: \w+\d+, on: on\)\n\s+content\(\)/);
    expect(swift).toMatch(/Toggle\(label\d+, isOn: on\)/);
    expect(swift).toMatch(
      /ScreenView_Card\(\w+\d+: model\.\w+, on: Binding\(get: \{ model\.\w+ \}, set: \{ model\.actions\(\d+, \[\$0\]\) \}\)\) \{\n\s+Text\("a"\)/,
    );
    expect(miniSwiftErrors(mini!, built)).toBe("");
  }, 300_000);
});
