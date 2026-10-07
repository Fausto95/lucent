// SwiftUI components written in Lucent: the JSX an
// iOS component returns is its SwiftUI body, generated as Swift;
// the rest of its setup is compiled into C++, which keeps the body's
// observable state and runs its actions (the setup's functions). The Swift type-checks against the iOS SDK,
// and its glue compiles with the runtime and React Native's headers.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, type CompileResult, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { compileErrors, iosHostToolchain } from "./react-native-headers.ts";
import { GALLERY, TOGGLE } from "./swiftui-fixture.ts";

const ios = process.platform === "darwin" && sdkAvailable("ios");

/** `files` in a package `@acme/app`, compiled for `platform`; the directory too. */
function build(
  files: Record<string, string>,
  platform: "ios" | "android" = "ios",
): { dir: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-swiftui-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const lucent = Object.keys(files).map((f) => path.join(dir, f));

  return { dir, result: compile(lucent, { platforms: [platform] }) };
}

const file = (r: CompileResult, pattern: RegExp) =>
  [...r.files].find(([name]) => pattern.test(name))?.[1] ?? "";

/** The Toggle fixture with its iOS setup's `body` (and imports) replaced. */
function toggle(body: string, imports = ""): Record<string, string> {
  return {
    "toggle.lucent.ts": TOGGLE["toggle.lucent.ts"],
    "toggle.ios.lucent.tsx": `import {
  Animation,
  Circle,
  Color,
  Text,
  VStack,
  withAnimation,
} from "lucent:swiftui";
import { expose, signal } from "lucent:ui";
import type { Props } from "./toggle.lucent";
${imports}
export function Toggle(props: Props) {
${body}
}
`,
  };
}

const errors = (r: CompileResult) => r.diagnostics.map((d) => [d.code, d.message]);

/** What swiftc says type-checking a compile's Swift files (written under `dir`) for the simulator. */
function swiftErrors(dir: string, result: CompileResult): string {
  const out = path.join(dir, "out");

  for (const [f, text] of result.files) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), text);
  }

  const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  const swift = [...result.files.keys()]
    .filter((f) => f.endsWith(".swift"))
    .map((f) => path.join(out, f));

  expect(swift).toHaveLength(1);

  return spawnSync(
    "xcrun",
    [
      "swiftc",
      "-typecheck",
      "-parse-as-library",
      "-warnings-as-errors",
      "-swift-version",
      "5",
      "-target",
      "arm64-apple-ios15.1-simulator",
      "-sdk",
      sdk,
      ...swift,
    ],
    { encoding: "utf8" },
  ).stderr;
}

/** The Swift a compile writes for its one SwiftUI component. */
const swiftOf = (r: CompileResult) =>
  [...r.files].find(([name]) => name.endsWith(".swift"))?.[1] ?? "";

describe("a SwiftUI component", () => {
  it.skipIf(!ios)(
    "returns its body as JSX, written out as SwiftUI, whose state and actions are Lucent's",
    async () => {
      const { result } = build(TOGGLE);

      expect(result.diagnostics).toEqual([]);
      expect(result.warnings ?? []).toEqual([]);

      const [component] = result.components ?? [];

      expect(component?.platforms.ios?.root).toEqual({
        module: "lucent:swiftui",
        name: "UIHostingController",
      });
      expect(component?.commands.map((c) => [c.name, c.result.kind])).toEqual([
        ["toggle", "enqueue"],
        ["pulse", "enqueue"],
        ["state", "request"],
      ]);

      const registration = component!.registration;
      const swift = file(result, new RegExp(`^ios/views/${registration}\\.swift$`));

      // The body: SwiftUI's own views and modifiers, the values its setup computes read from its model.
      expect(swift).toContain("import SwiftUI");
      expect(swift).toContain("fileprivate struct ToggleView: View {");
      expect(swift).toContain("@ObservedObject var model: ToggleModel");
      expect(swift).toContain("@Published var on0: Bool = false");
      // A template of a prop and a signal: one value, computed by the setup.
      expect(swift).toContain('@Published var value3: String = ""');
      expect(swift).toContain(
        "ZStack(alignment: model.on0 ? Alignment.trailing : Alignment.leading) {",
      );
      expect(swift).toContain(
        ".animation(Animation.spring(response: 0.35, dampingFraction: 0.6), value: model.on0)",
      );
      // A callback calling a setup function: the Swift calls that action.
      expect(swift).toContain(".onTapGesture { model.actions(0) }");
      // A conditional view in content is SwiftUI's own control flow.
      expect(swift).toMatch(/if model\.on0 \{\n\s+Text\("on"\)\n\s+\} else \{/);
      // Hosted in a controller, whose state Lucent code sets through C functions.
      expect(swift).toContain(`@_cdecl("lucent_swiftui_${registration}_make")`);
      expect(swift).toContain("ToggleHosting(rootView: ToggleView(model: ToggleModel(actions: ");
      expect(swift).toContain(`@_cdecl("lucent_swiftui_${registration}_set0")`);
      // Its content's size changes, SwiftUI's own too, reach the host: the
      // controller tracks the content's size, and tells the mount, never
      // UIKit (its parent view controller would hear of it).
      expect(swift).toContain(
        "fileprivate final class ToggleHosting: UIHostingController<ToggleView> {",
      );
      expect(swift).toMatch(
        /override var preferredContentSize: CGSize \{\n\s+get \{\n\s+reportedSize\n\s+\}\n\s+set \{\n\s+if newValue != reportedSize \{\n\s+reportedSize = newValue\n\s+rootView\.model\.actions\.contentResized\(\)/,
      );
      expect(swift).not.toContain("super.preferredContentSize");
      expect(swift).toMatch(
        /if #available\(iOS 16\.0, \*\) \{\n\s+controller\.sizingOptions = \.preferredContentSize\n/,
      );
      // The body is laid out in the host's box, which React Native keeps clear of the
      // screen's edges: no safe area insets of SwiftUI's own (iOS 16.4).
      expect(swift).toMatch(
        /if #available\(iOS 16\.4, \*\) \{\n\s+controller\.safeAreaRegions = \[\]\n/,
      );
      // withAnimation, called in a command, around the Lucent code it animates.
      expect(swift).toContain(
        "withAnimation(Animation.spring(response: 0.25, dampingFraction: 0.4)) { body(context) }",
      );

      await expect(swift).toMatchFileSnapshot("__snapshots__/ios/Toggle.swift.snap");

      const unit = file(result, /^ios\/m_toggle\.mm$/);

      // The glue declares the Swift side's C functions, and keeps each value in an effect.
      expect(unit).toContain(`void* lucent_swiftui_${registration}_make(`);
      expect(unit).toContain("#include <lucent/platform/swiftui.h>");
      expect(unit).toMatch(
        new RegExp(
          `lucent::ui::effect\\(lucent::ui::mainGraph\\(\\), lucent::ui::inContent\\(lucent_content, .*lucent_swiftui_${registration}_set0\\(.*"toggle\\.ios\\.lucent\\.tsx:\\d+", LUCENT_TRACE_SITE_AT\\("effect", "[^"]*toggle\\.ios\\.lucent\\.tsx", \\d+\\)\\)`,
          "s",
        ),
      );
      // The action is the setup's function, which enters its mount when it runs.
      expect(unit).toMatch(/->list\.push_back\(lucent::swiftui::action\(flip\)\);/);
      expect(unit).toContain("lucent::swiftui::animate(");
      // The actions know the mount, whose content a size change marks.
      expect(unit).toContain("std::make_shared<lucent::swiftui::Actions>(lucent_content)");
      expect(unit).toContain("&lucent::swiftui::resized");

      const header = file(result, /^ios\/m_toggle\.h$/);

      expect(header).toContain(
        "lucent::NativeRef Toggle_setup(lucent_app::m_toggle::Toggle_Props p0_, Toggle_Commands& lucent_commands);",
      );

      // The host shows the controller's view, and contains the controller.
      const view = file(result, /ComponentView\.mm$/);

      expect(view).toContain("UIViewController* controller() const override {");
    },
    300_000,
  );

  it.skipIf(!ios)(
    "type-checks as Swift, and its glue compiles with the runtime",
    () => {
      const { dir, result } = build(TOGGLE);

      expect(result.diagnostics).toEqual([]);

      const out = path.join(dir, "out");

      for (const [f, text] of result.files) {
        fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
        fs.writeFileSync(path.join(out, f), text);
      }

      const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
        encoding: "utf8",
      }).stdout.trim();
      const target = "arm64-apple-ios15.1-simulator";
      const swift = [...result.files.keys()]
        .filter((f) => f.endsWith(".swift"))
        .map((f) => path.join(out, f));

      expect(swift).toHaveLength(1);

      const swiftc = spawnSync(
        "xcrun",
        [
          "swiftc",
          "-typecheck",
          "-parse-as-library",
          "-warnings-as-errors",
          "-swift-version",
          "5",
          "-target",
          target,
          "-sdk",
          sdk,
          ...swift,
        ],
        { encoding: "utf8" },
      );

      expect(swiftc.stderr).toBe("");

      const glue = spawnSync(
        "xcrun",
        [
          "--sdk",
          "iphonesimulator",
          "clang++",
          "-std=c++20",
          "-ffp-contract=off",
          "-fobjc-arc",
          "-Werror",
          "-Wno-gnu-statement-expression",
          "-Wno-unused-label",
          "-Wno-parentheses-equality",
          "-Wno-comma",
          "-fsyntax-only",
          "-target",
          target,
          `-I${path.join(runtimeDir(), "cpp")}`,
          `-I${path.join(out, "ios")}`,
          "-x",
          "objective-c++",
          path.join(out, "ios/m_toggle.mm"),
        ],
        { encoding: "utf8" },
      );

      expect(glue.stderr).toBe("");

      fs.rmSync(dir, { recursive: true, force: true });
    },
    300_000,
  );

  const host = ios ? iosHostToolchain() : undefined;

  it.skipIf(!host)(
    "gives its host a controller to contain, which compiles with React Native's headers",
    () => {
      const { dir, result } = build(TOGGLE);
      const out = path.join(dir, "out");

      for (const [f, text] of result.files) {
        fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
        fs.writeFileSync(path.join(out, f), text);
      }

      const views = [...result.files.keys()]
        .filter((f) => f.endsWith("ComponentView.mm"))
        .map((f) => path.join(out, f));

      expect(views).toHaveLength(1);
      expect(
        compileErrors(host!, path.join(out, "ios"), [
          ...views,
          path.join(runtimeDir(), "cpp/rn/LucentComponentView.mm"),
        ]),
      ).toBe("");

      fs.rmSync(dir, { recursive: true, force: true });
    },
    300_000,
  );

  it.skipIf(!ios)(
    "writes each element as SwiftUI declares it: labels, order, content and actions",
    () => {
      const { result } = build(
        toggle(
          `  const taps = signal(0);
  const label = signal("x");
  const tap = () => taps.set(taps.peek() + 1);

  return (
    <VStack>
      <Text frame={{ width: 40 }} onTapGesture={[{ count: 2 }, () => tap()]}>a</Text>
      <HStack spacing={4}>
        <Image systemName="star" />
        <Spacer />
        <Text>{label.get()}</Text>
      </HStack>
      <Button action={() => tap()}>Go</Button>
      <Button action={tap}>
        <Text>x</Text>
      </Button>
      <Text padding={[Edge.Set.horizontal, 8]}>b</Text>
      <Text onTapGesture={[{ count: taps.get() }, tap]}>c</Text>
    </VStack>
  );`,
          'import { Button, Edge, HStack, Image, Spacer } from "lucent:swiftui";\n',
        ),
      );

      expect(errors(result)).toEqual([]);

      const swift = swiftOf(result);

      // A modifier whose first argument is labeled, and a trailing action after the object.
      expect(swift).toContain(
        'Text("a").frame(width: 40).onTapGesture(count: 2) { model.actions(0) }',
      );
      // Labeled and unlabeled initializers, and a trailing builder.
      expect(swift).toMatch(
        /HStack\(spacing: 4\) \{\n\s+Image\(systemName: "star"\)\n\s+Spacer\(\)\n\s+Text\(model\.\w+\)/,
      );
      // A labeled closure last is the trailing one; one in the object is an argument.
      expect(swift).toContain('Button("Go") { model.actions(0) }');
      expect(swift).toContain('Button(action: { model.actions(0) }) { Text("x") }');
      // Unlabeled arguments, in order; SwiftUI's nested types by their Swift names.
      expect(swift).toContain('Text("b").padding(Edge.Set.horizontal, 8)');
      // A number the setup computes, given where Swift takes an Int.
      expect(swift).toMatch(
        /Text\("c"\)\.onTapGesture\(count: Int\(model\.\w+\)\) \{ model\.actions\(0\) \}/,
      );
    },
    180_000,
  );

  it.skipIf(!ios)(
    "applies modifiers in the order written, a repeated one chained after the element",
    () => {
      const { result } = build(
        toggle(
          `  return (
    <ZStack alignment={Alignment.leading} padding={8} background={Color.red}>
      {(<Text padding={8} background={Color.red}>x</Text>).padding(4)}
    </ZStack>
  );`,
          'import { Alignment, ZStack } from "lucent:swiftui";\n',
        ),
      );

      expect(errors(result)).toEqual([]);
      expect(swiftOf(result)).toContain("ZStack(alignment: Alignment.leading) {");
      expect(swiftOf(result)).toContain("}.padding(8).background(Color.red)");
      expect(swiftOf(result)).toContain('Text("x").padding(8).background(Color.red).padding(4)');
    },
    180_000,
  );

  it.skipIf(!ios)(
    "makes a view given as a value with its initializer's labels",
    () => {
      const { dir, result } = build(
        toggle(
          `  return (
    <Text
      background={Color({ red: 1, green: 0.5, blue: 0 })}
      clipShape={Capsule({ style: RoundedCornerStyle.continuous })}
    >
      x
    </Text>
  );`,
          'import { Capsule, RoundedCornerStyle } from "lucent:swiftui";\n',
        ),
      );

      expect(errors(result)).toEqual([]);
      expect(swiftOf(result)).toContain(
        'Text("x").background(Color(red: 1, green: 0.5, blue: 0)).clipShape(Capsule(style: RoundedCornerStyle.continuous))',
      );
      expect(swiftErrors(dir, result)).toBe("");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "gives an attribute that is also a modifier's name to the initializer",
    () => {
      const { dir, result } = build(
        toggle(
          `  return (
    <VStack>
      <RoundedRectangle cornerRadius={8} fill={Color.green} />
      {(<Color red={1} green={0} blue={0} opacity={0.5} />).opacity(0.8)}
    </VStack>
  );`,
          'import { RoundedRectangle } from "lucent:swiftui";\n',
        ),
      );

      expect(errors(result)).toEqual([]);

      const swift = swiftOf(result);

      // The label is the initializer's; the modifier of the same name chains after the element.
      expect(swift).toContain("RoundedRectangle(cornerRadius: 8).fill(Color.green)");
      expect(swift).toContain("Color(red: 1, green: 0, blue: 0, opacity: 0.5).opacity(0.8)");
      expect(swiftErrors(dir, result)).toBe("");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "refuses what SwiftUI's declarations say it cannot write yet, with the reason",
    () => {
      const refused = (body: string, imports = "") => errors(build(toggle(body, imports)).result);

      expect(
        refused(
          `  return <GeometryReader>{() => <Text>x</Text>}</GeometryReader>;`,
          'import { GeometryReader } from "lucent:swiftui";\n',
        ),
      ).toContainEqual([
        "LUCENT3024",
        "`GeometryReader(content:)` cannot be written in a SwiftUI body yet: `content` builds its content from values it is given: a body writes result builders that take none, for now",
      ]);
      expect(refused(`  return <Text scrollDisabled={true}>x</Text>;`)).toContainEqual([
        "LUCENT3024",
        "`scrollDisabled(_:)` needs iOS 16.0 (apps run from iOS 15.1): a SwiftUI body writes what every supported iOS has, for now",
      ]);
    },
    180_000,
  );

  it.skipIf(!ios)(
    "writes a wider slice of SwiftUI that type-checks as Swift",
    () => {
      const { dir, result } = build(GALLERY);

      expect(result.diagnostics).toEqual([]);

      const swift = swiftOf(result);

      expect(swift).toContain("VStack(alignment: HorizontalAlignment.leading, spacing: 12) {");
      expect(swift).toContain('Image(systemName: "star.fill")');
      expect(swift).toMatch(/\.rotationEffect\(Angle\.degrees\(model\.\w+\)\)/);
      expect(swift).toContain(".padding(Edge.Set.horizontal, 16).padding(8)");
      expect(swift).toContain(".background(Color.blue.opacity(0.15))");
      expect(swift).toContain(".overlay(alignment: Alignment.topTrailing) {");
      expect(swift).toContain(".offset(x: 0, y: 4)");
      expect(swift).toContain(
        ".animation(Animation.spring(response: 0.3, dampingFraction: 0.5), value: model.",
      );
      expect(swift).toContain(
        "withAnimation(Animation.easeInOut(duration: 0.4)) { body(context) }",
      );
      expect(swiftErrors(dir, result)).toBe("");

      fs.rmSync(dir, { recursive: true, force: true });
    },
    300_000,
  );

  it.skipIf(!ios)(
    "builds SwiftUI views only in its body",
    () => {
      const made = (body: string) => errors(build(toggle(body)).result);

      expect(
        made(`  const dot = <Circle fill={Color.red} />;

  return <Text>x</Text>;`),
      ).toContainEqual([
        "LUCENT3024",
        "SwiftUI's views are made in the body, the JSX the component returns: write this view in it",
      ]);
      expect(
        made(`  const dot = Circle();

  return <Text>x</Text>;`),
      ).toContainEqual([
        "LUCENT3024",
        "a SwiftUI view or value is made only in the body a component returns: write `Circle()` there",
      ]);
    },
    180_000,
  );

  it.skipIf(!ios)(
    "refuses in its body what SwiftUI code cannot be written for",
    () => {
      // One diagnostic per setup: the first thing that cannot be written.
      const spread = build(toggle(`  return <Text {...{ padding: 8 }}>a</Text>;`)).result;
      const labels = build(
        toggle(`  const size = { width: 8, height: 8 };

  return <Circle frame={size} />;`),
      ).result;
      const element = build(
        toggle(`  return (
    <VStack>
      <Toggle title="x" />
    </VStack>
  );`),
      ).result;

      expect(errors(spread)).toContainEqual([
        "LUCENT3024",
        "write each attribute of a SwiftUI view as `name={value}`: `{...}` is not supported",
      ]);
      expect(errors(labels)).toContainEqual([
        "LUCENT3024",
        "`frame`'s value gives no form of the modifier: its arguments are one value, an object of its labeled ones, or a tuple of them (`frame={[a, { label: b }]}`)",
      ]);
      // A component is React's to mount; a function returning JSX that is not exported is a helper.
      expect(errors(element)).toContainEqual([
        "LUCENT3020",
        "`Toggle` is a component: React mounts it through its host, so Lucent code cannot call it or use it as a value",
      ]);
    },
    180_000,
  );

  it.skipIf(!ios)(
    "animates with animations it can write out in Swift",
    () => {
      const { result } = build(
        toggle(`  const scale = signal(1);
  const spring = { response: 0.3 };

  expose({
    pulse: () => {
      withAnimation(Animation.spring(spring), () => {
        scale.set(1.2);
      });
    },
  });

  return <Text scaleEffect={scale.get()}>x</Text>;`),
      );

      // Its Lucent values are numbers, booleans and strings, which cross as they are.
      expect(errors(result)).toContainEqual([
        "LUCENT3024",
        "withAnimation's animation takes SwiftUI's values, and numbers, booleans and strings Lucent code computes",
      ]);
    },
    180_000,
  );

  it.skipIf(!ios)(
    "keeps logic in the setup: the body reads its values and calls its functions",
    () => {
      const refused = (body: string) => errors(build(toggle(body)).result);

      expect(
        refused(`  const on = signal(false);

  return <Text onTapGesture={() => on.set(true)}>x</Text>;`),
      ).toContainEqual([
        "LUCENT3024",
        "the body changes `on` through a setup function it calls: logic is the setup's",
      ]);
      expect(
        refused(`  const make = () => <Text>x</Text>;

  return make();`),
      ).toContainEqual([
        "LUCENT3024",
        "a SwiftUI component returns its body: JSX of SwiftUI's views, which the setup's last statement returns",
      ]);
      expect(
        refused(`  const on = signal(false);

  if (on.peek()) return <Text>on</Text>;

  return <Text>off</Text>;`),
      ).toContainEqual([
        "LUCENT3024",
        "a SwiftUI component returns its body once, as the last statement of its setup: the body is one view, and its conditions are written in it (`{shown && <Text>…</Text>}`)",
      ]);
    },
    180_000,
  );

  it.skipIf(!ios)(
    "is the only place withAnimation runs",
    () => {
      const { result } = build({
        "motion.lucent.ts": "export declare function go(): void;\n",
        "motion.ios.lucent.ts": `import { Animation, withAnimation } from "lucent:swiftui";

export function go(): void {
  withAnimation(Animation.default, () => {});
}
`,
      });

      expect(errors(result)).toContainEqual([
        "LUCENT3024",
        "withAnimation animates a SwiftUI component's views: call it in the setup of a component whose body is SwiftUI, or in a function that setup creates",
      ]);
    },
    180_000,
  );

  it.skipIf(!sdkAvailable("android"))(
    "is iOS's: an Android module cannot import lucent:swiftui",
    () => {
      const { result } = build(
        {
          "dot.lucent.ts": "export declare function size(): number;\n",
          "dot.android.lucent.ts": `import type { View } from "lucent:swiftui";

export function size(): number {
  const v: View | null = null;
  return v === null ? 0 : 1;
}
`,
        },
        "android",
      );

      expect(errors(result)).toContainEqual([
        "LUCENT3004",
        "lucent:swiftui is iOS's: import it in an iOS module (.ios.lucent.ts or .ios.lucent.tsx)",
      ]);
    },
    180_000,
  );
});
