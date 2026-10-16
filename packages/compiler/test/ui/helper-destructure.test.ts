/**
 * Helper views destructuring their props (T123): `({ title, done: isDone })`
 * reads each prop by its own name, as `props.title` would, whatever the
 * prop holds (plain data, a callback, a toolkit's value, a bound signal,
 * children). Defaults, `...` and nested patterns are refused. Compose
 * bodies build against stand-ins for android.jar where the Android SDK is
 * missing, SwiftUI ones against the miniature SwiftUI where Xcode is
 * (whose Swift type-checks).
 */
import { describe, expect, it } from "vite-plus/test";
import { glueErrors, jdk } from "../jni-harness.ts";
import { buildSwiftUI, miniSwiftErrors, miniSwiftUI } from "./mini-swiftui.ts";
import { build, composeBuilds, diagnostics, generated } from "./toolkit-build.ts";

const DECLARATION = (view: string, from: string) => `import type { ${view} } from "${from}";

export type Props = { title: string; on: boolean };

export declare function Screen(props: Props): ${view};
`;

describe.skipIf(!composeBuilds())("a Compose helper view destructuring its props", () => {
  it("reads each by its name", () => {
    const built = build(
      {
        "screen.lucent.ts": DECLARATION("View", "lucent:android/android.view"),
        "screen.android.lucent.tsx": `import { BasicText, Color, Column, Modifier, Row, type Shown, Switch } from "lucent:compose";
import { type Bound, bind, signal } from "lucent:ui";
import type { Props } from "./screen.lucent";

function Line({
  title,
  done: isDone,
  tint,
  on,
  onTap,
  children,
}: {
  title: string;
  done: boolean;
  tint: Color;
  on: Bound<boolean>;
  onTap: () => void;
  children: Shown;
}) {
  return (
    <Row modifier={Modifier.clickable(onTap)}>
      <BasicText text={\`\${title}\${isDone ? " (done)" : ""}\`} modifier={Modifier.background(tint)} />
      <Switch checked={on} />
      {children}
    </Row>
  );
}

export function Screen(props: Props) {
  const on = signal(false);
  const tapped = () => {
    on.set(!on.peek());
  };

  return (
    <Column>
      <Line title={props.title} done={props.on} tint={Color.Red} on={bind(on)} onTap={tapped}>
        <BasicText text="child" />
      </Line>
    </Column>
  );
}
`,
      },
      "android",
    );

    expect(diagnostics(built.result)).toEqual([]);

    const kotlin = generated(built.result, /^dev\/lucent\/compose\/.*\.kt$/);

    expect(kotlin).toMatch(
      /fun \w+_Line\(value\d+: String, onTap: \(\) -> Unit, tint: Color, on: Boolean, onChanged: \(Boolean\) -> Unit, content: @Composable \(\) -> Unit\) \{/,
    );
    expect(kotlin).toContain("Row(modifier = Modifier.clickable(onClick = onTap)) {");
    expect(kotlin).toMatch(
      /BasicText\(text = value\d+, modifier = Modifier\.background\(color = tint\)\)/,
    );
    expect(kotlin).toContain("Switch(checked = on, onCheckedChange = onChanged)");
    // What it computes from them, the setup computes where it is used: the template, given its props.
    const glue = generated(built.result, /^android\/m_screen\.cpp$/);

    expect(glue).toContain('LUCENT_STR(" (done)")');
    expect(jdk ? glueErrors(built.result, built.dir, "android/m_screen.cpp") : "").toBe("");
  });
});

const mini = miniSwiftUI();

describe.skipIf(!mini)("a SwiftUI helper view destructuring its props", () => {
  it("reads each by its name", () => {
    const built = buildSwiftUI(mini!, {
      "screen.lucent.ts": DECLARATION("View", "lucent:swiftui"),
      "screen.ios.lucent.tsx": `import { Button, Color, Content, HStack, Text, Toggle, VStack } from "lucent:swiftui";
import { type Bound, bind, signal } from "lucent:ui";
import type { Props } from "./screen.lucent";

function Row({
  title,
  done: isDone,
  tint,
  on,
  onTap,
  children,
}: {
  title: string;
  done: boolean;
  tint: Color;
  on: Bound<boolean>;
  onTap: () => void;
  children: Content;
}) {
  return (
    <HStack onTapGesture={onTap}>
      <Text foregroundStyle={tint}>{\`\${title}\${isDone ? " (done)" : ""}\`}</Text>
      <Toggle isOn={on}>{title}</Toggle>
      <Button action={() => onTap()}>tap</Button>
      {children}
    </HStack>
  );
}

export function Screen(props: Props) {
  const on = signal(false);
  const tapped = () => {
    on.set(!on.peek());
  };

  return (
    <VStack>
      <Row title={props.title} done={props.on} tint={Color.red} on={bind(on)} onTap={tapped}>
        <Text>child</Text>
      </Row>
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

    expect(swift).toMatch(/Text\(value\d+\)\.foregroundStyle\(tint\)/);
    expect(swift).toMatch(/Toggle\(title\d+, isOn: on\)/);
    expect(swift).toContain('Button("tap") { onTap() }');
    expect(swift).toMatch(/content\(\)\n\s+\}\.onTapGesture \{ onTap\(\) \}/);
    expect(miniSwiftErrors(mini!, built)).toBe("");
  }, 300_000);

  it("refuses a default, `...` or a nested pattern", () => {
    const refused = (pattern: string) =>
      buildSwiftUI(mini!, {
        "screen.lucent.ts": DECLARATION("View", "lucent:swiftui"),
        "screen.ios.lucent.tsx": `import { Text, VStack } from "lucent:swiftui";
import type { Props } from "./screen.lucent";

function Badge(${pattern}: { n?: number; label: { text: string } }) {
  return <Text>x</Text>;
}

export function Screen(props: Props) {
  return <VStack><Badge n={1} label={{ text: "a" }} /></VStack>;
}
`,
      }).result.diagnostics.map((d) => `${d.code} ${d.message}`);
    const message =
      "LUCENT3024 the helper view `Badge` destructures each prop to a name, `({ title, done: isDone })`: no defaults, `...` or nested patterns";

    expect(refused("{ n = 1 }")).toContain(message);
    expect(refused("{ ...rest }")).toContain(message);
    expect(refused("{ label: { text } }")).toContain(message);
  }, 300_000);
});
