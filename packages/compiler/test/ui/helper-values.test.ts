/**
 * Helper views taking their toolkit's values (T123): a prop holding a
 * `Color`, a `Font` or a `Modifier` is a parameter of the helper's Swift
 * view or Kotlin composable, of the toolkit's type, and its user writes the
 * value where it draws, as the toolkit's code it is. An optional one is
 * nil or null when left out, and the helper may default it with `??`.
 * Compose bodies are built against stand-ins for android.jar where the
 * Android SDK is missing, SwiftUI ones against the miniature SwiftUI where
 * Xcode is (whose Swift type-checks).
 */
import { describe, expect, it } from "vite-plus/test";
import { buildSwiftUI, miniSwiftErrors, miniSwiftUI } from "./mini-swiftui.ts";
import { build, composeBuilds, diagnostics, generated } from "./toolkit-build.ts";

const DECLARATION = (view: string, from: string) => `import type { ${view} } from "${from}";

export type Props = { title: string; on: boolean };

export declare function Screen(props: Props): ${view};
`;

describe.skipIf(!composeBuilds())("a Compose helper view taking Compose's values", () => {
  it("takes each as a parameter of its type, its user writing the value", () => {
    const { result } = build(
      {
        "screen.lucent.ts": DECLARATION("View", "lucent:android/android.view"),
        "screen.android.lucent.tsx": `import { BasicText, Box, Color, Column, dp, Modifier } from "lucent:compose";
import type { Props } from "./screen.lucent";

function Swatch(props: { tint: Color; modifier?: Modifier; label: string }) {
  return (
    <Box modifier={(props.modifier ?? Modifier).background(props.tint).size(dp(24))}>
      <BasicText text={props.label} />
    </Box>
  );
}

export function Screen(props: Props) {
  return (
    <Column>
      <Swatch tint={props.on ? Color.Red : Color.Blue} modifier={Modifier.padding(dp(4))} label={props.title} />
      <Swatch tint={Color.Green.copy({ alpha: 0.5 })} label={"b"} />
    </Column>
  );
}
`,
      },
      "android",
    );

    expect(diagnostics(result)).toEqual([]);

    const kotlin = generated(result, /^dev\/lucent\/compose\/.*\.kt$/);

    expect(kotlin).toMatch(/^import androidx\.compose\.ui\.graphics\.Color$/m);
    expect(kotlin).toMatch(
      /fun \w+_Swatch\(label\d+: String, tint: Color, modifier: Modifier\?\) \{/,
    );
    expect(kotlin).toContain(
      "Box(modifier = (modifier ?: Modifier).background(color = tint).size(size = 24.0.dp))",
    );
    expect(kotlin).toMatch(
      /_Swatch\(label\d+ = lucent\.\w+\.value, tint = if \(lucent\.\w+\.value\) Color\.Red else Color\.Blue, modifier = Modifier\.padding\(all = 4\.0\.dp\)\)/,
    );
    expect(kotlin).toMatch(/tint = Color\.Green\.copy\(alpha = 0\.5f\), modifier = null\)/);
  });

  it("refuses a prop of what is neither plain data, a callback nor Compose's value", () => {
    const { result } = build(
      {
        "screen.lucent.ts": DECLARATION("View", "lucent:android/android.view"),
        "screen.android.lucent.tsx": `import { BasicText, Column } from "lucent:compose";
import type { Props } from "./screen.lucent";

function Line(props: { label: string; at: Date }) {
  return <BasicText text={props.label} />;
}

export function Screen(props: Props) {
  return (
    <Column>
      <Line label={props.title} at={new Date()} />
    </Column>
  );
}
`,
      },
      "android",
    );

    expect(diagnostics(result)).toContainEqual(
      "LUCENT3024 the helper view `Line` takes plain data, callbacks and Compose's values: `at` is `Date`",
    );
  });
});

const mini = miniSwiftUI();

describe.skipIf(!mini)("a SwiftUI helper view taking SwiftUI's values", () => {
  it("takes each as a property of its type, its user writing the value", () => {
    const built = buildSwiftUI(mini!, {
      "screen.lucent.ts": DECLARATION("View", "lucent:swiftui"),
      "screen.ios.lucent.tsx": `import { Color, Font, HStack, Text, VStack } from "lucent:swiftui";
import type { Props } from "./screen.lucent";

function Swatch(props: { tint: Color; font?: Font; label: string }) {
  return (
    <HStack>
      <Text font={props.font ?? Font.body} foregroundStyle={props.tint}>
        {props.label}
      </Text>
    </HStack>
  );
}

export function Screen(props: Props) {
  return (
    <VStack>
      <Swatch tint={props.on ? Color.red : Color.blue} font={Font.title} label={props.title} />
      <Swatch tint={Color.green.opacity(0.5)} label={"b"} />
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
      /struct ScreenView_Swatch: View \{\n {2}let label\d+: String\n {2}let tint: Color\n {2}let font: Font\?\n/,
    );
    expect(swift).toMatch(
      /Text\(label\d+\)\.font\(font \?\? Font\.body\)\.foregroundStyle\(tint\)/,
    );
    expect(swift).toMatch(
      /ScreenView_Swatch\(label\d+: model\.\w+, tint: model\.\w+ \? Color\.red : Color\.blue, font: Font\.title\)/,
    );
    expect(swift).toMatch(/tint: Color\.green\.opacity\(0\.5\), font: nil\)/);
    expect(miniSwiftErrors(mini!, built)).toBe("");
  }, 300_000);
});
