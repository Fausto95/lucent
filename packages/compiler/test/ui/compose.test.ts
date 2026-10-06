import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { kotlinToolchain } from "../../../bindgen/test/kotlin-toolchain.ts";
import {
  compile,
  deferredLibraryGradle,
  libraryBuildGradle,
  runtimeDir,
  sdkAvailable,
  type SdkOptions,
} from "../../src/index.ts";
import { TOGGLE, withContent } from "./compose-fixture.ts";
import { androidToolchain, compileErrors } from "./react-native-headers.ts";
import { composeClasspath } from "./toolkit-build.ts";
import { runKotlinc } from "../../../bindgen/test/jvm-tools.ts";

const android = sdkAvailable("android");
const kotlin = kotlinToolchain();

function compileApp(files: Record<string, string> = TOGGLE, sdk?: SdkOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compose-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["android"], sdk },
  );

  return { dir, result };
}

const KOTLIN = /^dev\/lucent\/compose\/(LucentToggle_[0-9a-f]{12})\.kt$/;

/** The generated Kotlin file of the Toggle, and its registration name. */
function kotlinOf(result: ReturnType<typeof compileApp>["result"]) {
  const [file, text] = [...(result.kotlin ?? [])].find(([f]) => KOTLIN.test(f)) ?? [];

  if (!file || !text) throw new Error("no Kotlin for the Toggle's content");

  return { text, registration: KOTLIN.exec(file)![1]! };
}

describe.skipIf(!android)("components whose content is Compose", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it("write the content's body as a Kotlin composable", async () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result } = compileApp();

    expect(result.diagnostics).toEqual([]);
    expect(result.compose).toBe(true);

    const { text, registration } = kotlinOf(result);

    // Elements: props are named arguments, children the content lambda.
    expect(text).toContain("Column(horizontalAlignment = Alignment.CenterHorizontally) {");
    expect(text).toContain("Modifier.offset(x = knob.value)");
    expect(text).toMatch(/if \(lucent\.on\d+\.value\) \{\n\s+Text\(text = "on"\)/);
    // The runtime hosts it: the generated object only gives it the composable, reading the holder.
    expect(text).toContain(
      `return LucentComposition(context) { ${registration}Content(state as ${registration}State) }`,
    );
    expect(text).not.toMatch(/ViewCompositionStrategy|disposeComposition|ComposeView/);

    await expect(text.replaceAll(registration, "LucentToggle")).toMatchFileSnapshot(
      "__snapshots__/android/Toggle.kt.snap",
    );
  }, 300_000);

  it("compile where the iOS SDK is missing, a declaration's SwiftUI view untyped", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result } = compileApp(
      {
        ...TOGGLE,
        "toggle.lucent.ts": TOGGLE["toggle.lucent.ts"]
          .replace(
            'import type { View } from "lucent:android/android.view";',
            'import type { ComposeView } from "lucent:compose";\nimport type { View } from "lucent:swiftui";',
          )
          .replace("props: Props): View;", "props: Props): View | ComposeView;"),
      },
      { ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") } },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compose).toBe(true);
  }, 300_000);

  it("change the build identity when only the content's Kotlin changes", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result: a } = compileApp();
    const { result: b } = compileApp({
      ...TOGGLE,
      "toggle.android.lucent.tsx": TOGGLE["toggle.android.lucent.tsx"].replace(
        '<Text text="on" />',
        '<Text text="ON" />',
      ),
    });

    expect(a.diagnostics).toEqual([]);
    expect(b.diagnostics).toEqual([]);
    expect(kotlinOf(b).text).not.toBe(kotlinOf(a).text);
    // The app compiles the Kotlin: a binary built from the old one is another program.
    expect(b.identity!.programs.android).not.toBe(a.identity!.programs.android);
  }, 300_000);

  it("feed the content from the setup: state set by effects, functions it calls", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result } = compileApp();
    const { registration } = kotlinOf(result);
    const glue = result.files.get("android/m_toggle.cpp") ?? "";

    expect(glue).toContain("#include <lucent/platform/compose.h>");
    expect(glue).toContain(
      `lucent::compose::Holder::create("dev/lucent/compose/${registration}State", "dev/lucent/compose/${registration}Host")`,
    );
    // A handler the content calls: the Lucent function.
    expect(glue).toMatch(/\.setAction\(\d+, flip, "toggle\.android\.lucent\.tsx:\d+"\)/);
    // What the content reads from the setup: an effect each, calling the function computing it,
    // the text computed in C++.
    expect(glue).toMatch(
      /lucent::Fn<bool\(\)> (v\d+_) = lucent::Fn<bool\(\)>\(\[on = on\]\(\) mutable -> bool \{[^}]*return on\.get\(\);[^]*lucent::ui::effect\(lucent::ui::mainGraph\(\), lucent::ui::inContent\(lucent_content, \[content_\d+, lucent_get = \1\]\(\) mutable \{/,
    );
    expect(glue).toMatch(/double (v\d+_) = pulses\.get\(\);[^}]*return \1 == 0\.0;/);
    expect(glue).toContain('+ LUCENT_STR(" taps")');
    // The mount's end disposes the composition.
    expect(glue).toMatch(/->onCleanup\(\[content_\d+\]\(\) \{\n\s+content_\d+\.dispose\(\);/);
  }, 300_000);

  it("build the Android library with the Compose compiler and libraries", () => {
    const template = fs.readFileSync(
      path.join(runtimeDir(), "native/android/build.gradle"),
      "utf8",
    );
    // The content's Kotlin: the libraries of the packages it imports join Compose's own.
    const content = (...imports: string[]) =>
      `package dev.lucent.compose\n\n${imports.map((i) => `import ${i}\n`).join("")}`;
    const gradle = libraryBuildGradle(template, undefined, false, [
      content("androidx.compose.foundation.layout.Box"),
    ]);

    expect(gradle).toContain('apply plugin: "org.jetbrains.kotlin.android"');
    expect(gradle).toContain('apply plugin: "org.jetbrains.kotlin.plugin.compose"');
    expect(gradle).toContain(
      'classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:${kotlinPlugin}")',
    );
    expect(gradle).toMatch(/buildFeatures \{\n\s+compose true/);
    expect(gradle).toContain('implementation(platform("androidx.compose:compose-bom:');
    expect(gradle).toContain('implementation("androidx.compose.foundation:foundation")');
    // The runtime's host of Compose content, and the owners it finds for it.
    expect(gradle).toContain('sourceSets.main.java.srcDirs += "src/compose/java"');
    expect(gradle).toMatch(/implementation\("androidx\.lifecycle:lifecycle-viewmodel:[\d.]+"\)/);
    expect(gradle).not.toContain("material3");
    expect(
      libraryBuildGradle(template, undefined, false, [
        content("androidx.compose.foundation.layout.Box"),
        content("androidx.compose.material3.Text"),
      ]),
    ).toContain('implementation("androidx.compose.material3:material3")');
    expect(libraryBuildGradle(template, undefined, true, [])).not.toContain("compose");
  });

  it("reach the runtime's host by names a release build's shrinker keeps", () => {
    // R8 renames AndroidX classes (Expo's release builds shrink): a JNI descriptor naming
    // one finds no method. Lucent's own classes are kept (consumer-rules.pro).
    const glue = fs.readFileSync(path.join(runtimeDir(), "cpp/lucent/platform/compose.h"), "utf8");
    const named = [...glue.matchAll(/L([\w/$]+);/g)].map((m) => m[1]!);

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((c) => !/^(android|java|dev\/lucent)\//.test(c))).toEqual([]);
  });

  it("configure a deferred Android build for Compose content while views are generated", () => {
    // After expo prebuild, the first Gradle build configures the library before it builds
    // Android: it builds whatever Android turns out to need.
    expect(deferredLibraryGradle(undefined)).not.toContain("compose");

    process.env.LUCENT_VIEWS = "fabric";

    const gradle = deferredLibraryGradle(undefined);

    expect(gradle).toContain('apply plugin: "org.jetbrains.kotlin.plugin.compose"');
    expect(gradle).toContain('sourceSets.main.java.srcDirs += "src/compose/java"');
    expect(gradle).toContain('implementation(platform("androidx.compose:compose-bom:');
    // What the content imports is not known yet: every library lucent:compose binds.
    expect(gradle).toContain('implementation("androidx.compose.material3:material3")');
  });

  const composeJars = kotlin && composeClasspath();

  it.skipIf(!kotlin || !composeJars)(
    "compile the content with the Compose compiler, warnings as errors",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { dir, result } = compileApp();
      const { text } = kotlinOf(result);
      const source = path.join(dir, "Toggle.kt");
      const plugin = path.join(kotlin!.lib, "compose-compiler-plugin.jar");
      // With the runtime's host, which it calls.
      const host = path.join(runtimeDir(), "native/android/src/compose/java");
      const runtime = fs
        .readdirSync(host, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".kt"))
        .map((f) => path.join(host, f));

      fs.writeFileSync(source, text);

      const kotlinc = runKotlinc(kotlin!, [
        "-jvm-target",
        "11",
        "-Werror",
        `-Xplugin=${plugin}`,
        "-cp",
        composeJars!.join(path.delimiter),
        source,
        ...runtime,
        "-d",
        path.join(dir, "toggle.jar"),
      ]);

      expect(kotlinc.stderr).toBe("");
      expect(kotlinc.status).toBe(0);

      fs.rmSync(dir, { recursive: true, force: true });
    },
    600_000,
  );

  const toolchain = androidToolchain();

  it.skipIf(!toolchain)(
    "compile the setup's glue with the Android host against React Native's headers",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { dir, result } = compileApp();
      const out = path.join(dir, "generated");

      for (const [name, text] of result.files) {
        fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
        fs.writeFileSync(path.join(out, name), text);
      }

      const sources = [...result.files.keys()]
        .filter((f) => f.startsWith("android/") && f.endsWith(".cpp"))
        .filter((f) => !f.endsWith("lucent_identity.cpp"))
        .map((f) => path.join(out, f));
      const lucent = {
        command: toolchain!.command,
        args: [
          ...toolchain!.args,
          "-Wno-unused-variable",
          `-I${path.join(out, "android")}`,
          `-I${path.join(runtimeDir(), "native/android/include")}`,
        ],
      };

      expect(compileErrors(lucent, path.join(out, "android"), sources)).toBe("");

      fs.rmSync(dir, { recursive: true, force: true });
    },
    600_000,
  );

  /** Refused content: the composition statements and returned JSX, and more names they import. */
  const REFUSED: [string, string, string, RegExp, { compose?: string[]; ui?: string[] }?][] = [
    [
      "a let composition statement",
      '  let n = remember(() => 1);\n\n  return <Text text="x" />;',
      "LUCENT3024",
      /declares values with const/,
    ],
    [
      "an event sent from the composition",
      "  LaunchedEffect(true, async () => {\n    props.onChange?.(true, 1);\n  });\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /`props\.onChange` is an event/,
    ],
    [
      "a signal set from the content",
      "  return <Box modifier={Modifier.clickable(() => {\n    taps.set(1);\n  })} />;",
      "LUCENT3024",
      /changes `taps` through a setup function it calls/,
    ],
    [
      "a composable called from a callback",
      "  return <Box modifier={Modifier.clickable(() => {\n    remember(() => 1);\n  })} />;",
      "LUCENT3024",
      /remember is composable/,
    ],
    [
      "a suspend function called outside a coroutine",
      "  const s = remember(() => Animatable(1));\n\n  DisposableEffect(true, () => {\n    s.snapTo(2);\n    return () => {};\n  });\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /s\.snapTo suspends/,
    ],
    [
      "a handler called where the content composes",
      "  LaunchedEffect(flip(), async () => {});\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /`flip\(\)` would run each time Compose evaluates the body/,
    ],
    [
      "props spread on an element",
      "  return <Box {...{ modifier: Modifier }} />;",
      "LUCENT3024",
      /Box's props are written one by one: `name=\{value\}`/,
    ],
    [
      "a composable called for nothing",
      "  Box({ modifier: Modifier });\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /`Box` shows content: write it as an element, `<Box …\/>`/,
    ],
    [
      "a composable returned rather than written as an element",
      "  return Box({ modifier: Modifier });",
      "LUCENT3024",
      /a Compose component returns its body: JSX of Compose's views/,
    ],
    [
      "a Compose value made by setup code",
      "  const spec = spring();\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /`spring\(\)` is Compose's: make it in the JSX the component returns, or in a composition statement/,
    ],
    [
      "a call the content cannot make",
      "  return <Text text={[1].join()} />;",
      "LUCENT3024",
      /cannot call `\[1\]\.join`/,
    ],
    [
      "a composition value read by setup code",
      "  const dark = isSystemInDarkTheme();\n\n  effect(() => {\n    console.log(`${dark}`);\n  });\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /`dark` is a value of the composition: setup code, which runs before the content composes, cannot read it/,
      { compose: ["isSystemInDarkTheme"], ui: ["effect"] },
    ],
    [
      "a composition statement in an if",
      '  if (props.title === "") LaunchedEffect(true, async () => {});\n\n  return <Box modifier={Modifier} />;',
      "LUCENT3024",
      /`LaunchedEffect` composes: a composition statement stands in the component's own code, not in an if, a loop or a block/,
    ],
    [
      "a composable used in a function of the setup",
      "  const dark = () => isSystemInDarkTheme();\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /`isSystemInDarkTheme` composes: use it in a statement of the component's own code, which is lifted into the content, not in a function of the setup/,
      { compose: ["isSystemInDarkTheme"] },
    ],
    [
      "JSX the component does not return",
      "  const later = [<Box modifier={Modifier} />];\n\n  return <Box modifier={Modifier} />;",
      "LUCENT3024",
      /Compose's views are made in the body/,
    ],
    [
      "a composable property read from a callback",
      "  return <Box modifier={Modifier.clickable(() => {\n    const density = LocalDensity.current;\n  })} />;",
      "LUCENT3024",
      /LocalDensity\.current is composable: read it where the body composes, not in a callback/,
      { compose: ["LocalDensity"] },
    ],
  ];

  it("conform to a declaration by the view the returned JSX makes: a ComposeView", () => {
    process.env.LUCENT_VIEWS = "fabric";

    // A ComposeView is a View (the fixture's declaration), not a TextView.
    const declared = TOGGLE["toggle.lucent.ts"]
      .replace(
        'import type { View } from "lucent:android/android.view";',
        'import type { TextView } from "lucent:android/android.widget";',
      )
      .replace("): View;", "): TextView;");
    const { result } = compileApp({ ...TOGGLE, "toggle.lucent.ts": declared });

    expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      "LUCENT3005 Toggle in toggle.android.lucent.tsx has type (props: Props) => Composed, which does not match (props: Props) => TextView declared in toggle.lucent.ts",
    ]);
  }, 300_000);

  it("lift the component's composition statements into its content, in order", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result } = compileApp(
      withContent(
        '  const dark = isSystemInDarkTheme();\n  const label = `${props.title}!`;\n  const first = rememberSaveable(() => label);\n\n  return <Text text={dark ? first : "light"} />;',
        { compose: ["isSystemInDarkTheme", "rememberSaveable"] },
      ),
    );

    expect(result.diagnostics).toEqual([]);

    const { text } = kotlinOf(result);

    // Composition statements compose, in order, before what the JSX shows; they read the
    // setup's values (`label`, setup code between them) as the JSX does, from the holder.
    expect(text).toMatch(
      /val dark = isSystemInDarkTheme\(\)\n\s+val first = rememberSaveable \{ lucent\.label\d+\.value \}\n\s+Text\(text = if \(dark\) first else "light"\)/,
    );

    // The setup's C++ computes `label`, and composes nothing.
    const glue = result.files.get("android/m_toggle.cpp") ?? "";

    expect(glue).toMatch(/\[label = label\]\(\) mutable -> lucent::String \{[^}]*return label;/);
    expect(glue).not.toContain("isSystemInDarkTheme");
    expect(glue).not.toContain("rememberSaveable");
  }, 300_000);

  for (const [name, content, code, message, imports] of REFUSED)
    it(`refuse ${name}`, () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { result } = compileApp(withContent(content, imports));

      expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toContainEqual(
        expect.stringMatching(new RegExp(`^${code} .*${message.source}`)),
      );
    }, 300_000);

  it("take a function returning Compose's JSX as a helper view", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const files = withContent("  return <Knob />;", { compose: ["type Composed"] });
    const file = files["toggle.android.lucent.tsx"]!.replace(
      "export function Toggle(",
      "function Knob(): Composed {\n  return <Box modifier={Modifier} />;\n}\n\nexport function Toggle(",
    );
    const { result } = compileApp({ ...files, "toggle.android.lucent.tsx": file });

    // Not exported, it is no component: a composable of the body's (compose-helpers.test.ts).
    expect(result.diagnostics).toEqual([]);
  }, 300_000);

  it.skipIf(!sdkAvailable("ios"))(
    "refuse lucent:compose outside Android files",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compose-"));

      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
      fs.writeFileSync(path.join(dir, "unit.lucent.ts"), "export declare const unit: string;\n");
      fs.writeFileSync(
        path.join(dir, "unit.ios.lucent.ts"),
        'import { dp } from "lucent:compose";\n\nexport const unit = typeof dp;\n',
      );

      const result = compile(
        [path.join(dir, "unit.lucent.ts"), path.join(dir, "unit.ios.lucent.ts")],
        {
          platforms: ["ios"],
        },
      );

      expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toContainEqual(
        "LUCENT3004 lucent:compose is Android's: import it in an Android module (.android.lucent.ts or .android.lucent.tsx)",
      );
    },
    300_000,
  );
});
