import { spawnSync } from "node:child_process";
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
} from "../../src/index.ts";
import { TOGGLE, withBody } from "./compose-fixture.ts";
import { androidToolchain, compileErrors } from "./react-native-headers.ts";
import { composeClasspath } from "./toolkit-build.ts";

const android = sdkAvailable("android");
const kotlin = kotlinToolchain();

function compileApp(files: Record<string, string> = TOGGLE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compose-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["android"] },
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

    // Call form: named arguments as one object, content as a lambda returning an array.
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
    // What the content reads from the setup: an effect each, the text computed in C++.
    expect(glue).toMatch(
      /lucent::ui::effect\(lucent::ui::mainGraph\(\), lucent::ui::inContent\(lucent_content, \[content_\d+, on\]\(\) mutable \{/,
    );
    expect(glue).toMatch(/\.set\(\d+, pulses\.get\(\) == 0\.0\);/);
    expect(glue).toContain("lucent::concat(");
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

      const kotlinc = spawnSync(
        kotlin!.kotlinc,
        [
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
        ],
        { encoding: "utf8", maxBuffer: 1 << 26 },
      );

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

  const REFUSED: [string, string, string, RegExp][] = [
    [
      "a let in the body",
      '() => {\n    let n = 1;\n    return Text({ text: "x" });\n  }',
      "LUCENT3024",
      /declares values with const/,
    ],
    [
      "an event sent from the body",
      "() => {\n    props.onChange?.(true, 1);\n    return Box({ modifier: Modifier });\n  }",
      "LUCENT3024",
      /`props\.onChange` is an event/,
    ],
    [
      "a signal set from the body",
      "() => Box({ modifier: Modifier.clickable(() => {\n    taps.set(1);\n  }) })",
      "LUCENT3024",
      /changes `taps` through a setup function it calls/,
    ],
    [
      "a composable called from a callback",
      "() => Box({ modifier: Modifier.clickable(() => {\n    remember(() => 1);\n  }) })",
      "LUCENT3024",
      /remember is composable/,
    ],
    [
      "a suspend function called where the body composes",
      "() => {\n    const s = remember(() => Animatable(1));\n    s.snapTo(2);\n    return Box({ modifier: Modifier });\n  }",
      "LUCENT3024",
      /s\.snapTo suspends/,
    ],
    [
      "a handler called where the body composes",
      "() => {\n    flip();\n    return Box({ modifier: Modifier });\n  }",
      "LUCENT3024",
      /`flip\(\)` would run each time Compose evaluates the body/,
    ],
    [
      "arguments spread on a composable",
      "() => Box({ ...{ modifier: Modifier } })",
      "LUCENT3024",
      /write each of Box's named arguments as `name: value`/,
    ],
    [
      "a composable called for nothing",
      "() => {\n    Box({ modifier: Modifier });\n    return Box({ modifier: Modifier });\n  }",
      "LUCENT3024",
      /`Box\(\)` shows content: return it in the body's or a content lambda's array/,
    ],
    [
      "content that is not an array",
      "() => Column({}, () => Box({ modifier: Modifier }))",
      "LUCENT9001",
      /Type 'Composed' is missing the following properties from type 'readonly Shown\[\]'/,
    ],
    ["JSX", "() => <Box />", "LUCENT9001", /--jsx/],
    [
      "a call the content cannot make",
      "() => Text({ text: [1].join() })",
      "LUCENT3024",
      /cannot call `\[1\]\.join`/,
    ],
  ];

  it("keep saveable state and read the theme where the content composes", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const files = withBody(
      '() => {\n    const first = rememberSaveable(() => "saved");\n\n    return Text({ text: isSystemInDarkTheme() ? first : "light" });\n  }',
    );
    const file = files["toggle.android.lucent.tsx"]!.replace(
      "  remember,\n",
      "  isSystemInDarkTheme,\n  remember,\n  rememberSaveable,\n",
    );
    const { result } = compileApp({ ...files, "toggle.android.lucent.tsx": file });

    expect(result.diagnostics).toEqual([]);

    const { text } = kotlinOf(result);

    expect(text).toContain('val first = rememberSaveable { "saved" }');
    expect(text).toContain('Text(text = if (isSystemInDarkTheme()) first else "light")');
  }, 300_000);

  for (const [name, body, code, message] of REFUSED)
    it(`refuse ${name}`, () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { result } = compileApp(withBody(body));

      expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toContainEqual(
        expect.stringMatching(new RegExp(`^${code} .*${message.source}`)),
      );
    }, 300_000);

  it("refuse a composable property read from a callback", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const files = withBody(
      "() => Box({ modifier: Modifier.clickable(() => {\n    const density = LocalDensity.current;\n  }) })",
    );
    const file = files["toggle.android.lucent.tsx"]!.replace(
      "  spring,\n",
      "  spring,\n  LocalDensity,\n",
    );
    const { result } = compileApp({ ...files, "toggle.android.lucent.tsx": file });

    expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3024 LocalDensity\.current is composable: read it where the body composes, not in a callback/,
      ),
    );
  }, 300_000);

  it("refuse content made outside the setup's own code", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const file = TOGGLE["toggle.android.lucent.tsx"].replace(
      "  return compose(",
      "  const later = () => compose(() => Box({ modifier: Modifier }));\n\n  return compose(",
    );
    const { result } = compileApp({ ...TOGGLE, "toggle.android.lucent.tsx": file });

    expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3024 compose\(\) makes a component's view: call it once in the setup's own code/,
      ),
    );
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
