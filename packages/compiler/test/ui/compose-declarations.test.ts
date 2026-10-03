import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { kotlinToolchain } from "../../../bindgen/test/kotlin-toolchain.ts";
import { compile, runtimeDir, sdkAvailable } from "../../src/index.ts";
import { composeDeclarations } from "../../src/ui/compose-dts.ts";
import { composeArtifacts, kotlinClasspath } from "./compose-artifacts.ts";
import { TOGGLE, withContent } from "./compose-fixture.ts";
import { SLICE } from "./compose-slice-fixture.ts";
import { runKotlinc } from "../../../bindgen/test/kotlin-compiler.ts";

/*
 * lucent:compose's declarations, made from Compose's bindings by rules,
 * and the content writer reading each declaration's binding: Kotlin's
 * names, each parameter's kind and default, and its number type, through
 * generics too.
 */

const android = sdkAvailable("android");
const kotlin = kotlinToolchain();
const artifacts = composeArtifacts();

function compileApp(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-compose-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["android"] },
  );
  const [, text] =
    [...(result.kotlin ?? [])].find(([f]) => f.startsWith("dev/lucent/compose/")) ?? [];

  return { dir, result, text: text ?? "" };
}

describe("lucent:compose's declarations", () => {
  const text = () => composeDeclarations().text;

  /** A top-level declaration's lines: `interface Modifier`, `namespace Color`. */
  const block = (head: string) => {
    const start = text().indexOf(`export declare ${head} {`);
    return start < 0 ? "" : text().slice(start, text().indexOf("\n}\n", start));
  };

  it("declare composables showing UI as elements: named arguments as props, content as children", () => {
    expect(text()).toContain(
      "export declare function Box(props: { modifier?: Modifier; contentAlignment?: Alignment; propagateMinConstraints?: boolean; children: ScopedChildren<BoxScope> }): Composed;",
    );
    // Kotlin's other Box takes a modifier, and no content.
    expect(text()).toContain(
      "export declare function Box(props: { modifier: Modifier }): Composed;",
    );
    expect(text()).toContain(
      "export declare function Column(props: { modifier?: Modifier; verticalArrangement?: Arrangement.Vertical; horizontalAlignment?: Alignment.Horizontal; children: ScopedChildren<ColumnScope> }): Composed;",
    );
    expect(text()).toContain(
      "export declare function Spacer(props: { modifier: Modifier }): Composed;",
    );
  });

  it("take other functions' parameters in order, defaults optional or in one options object", () => {
    // Composables giving values, and effects, are functions.
    expect(text()).toContain(
      "export declare function animateFloatAsState(targetValue: Float, animationSpec?: AnimationSpec<Float>, visibilityThreshold?: Float, label?: string, finishedListener?: ((arg0: Float) => void) | null): State<Float>;",
    );
    expect(text()).toContain("export declare function remember<T>(calculation: () => T): T;");
    expect(text()).toContain(
      "export declare function LaunchedEffect(key1: unknown, block: () => Promise<void>): void;",
    );
    // The effect's lambda gives back the function DisposableEffectScope.onDispose takes.
    expect(text()).toContain(
      "export declare function DisposableEffect(key1: unknown, effect: () => () => void): void;",
    );
    // Every parameter defaulted.
    expect(text()).toContain(
      "export declare function spring<T>(options?: { dampingRatio?: Float; stiffness?: Float; visibilityThreshold?: T | null }): SpringSpec<T>;",
    );
    // A default before a parameter without one.
    expect(text()).toContain(
      "clickable(onClick: () => void, options?: { enabled?: boolean; onClickLabel?: string | null; role?: Role | null; interactionSource?: MutableInteractionSource | null }): this;",
    );
  });

  it("declare classes as interfaces with their extensions, statics and constructors", () => {
    expect(text()).toContain("export declare const Modifier: Modifier;");
    // A modifier's extensions give back the modifier they are called on: a scope's keeps its methods.
    expect(block("interface Modifier")).toContain("\n  padding(all: Dp): this;");
    expect(block("namespace Color")).toContain("\n  const White: Color;");
    expect(text()).toContain("export declare function Color(color: Long): Color;");
    // A value class's constructor, as Kotlin calls it.
    expect(text()).toContain("export declare function Dp(value: Float): Dp;");
    // `20.dp`: the Double's keeps the name; TypeScript cannot tell the Int's apart.
    expect(text()).toContain("export declare function dp(receiver: number): Dp;");
    expect(text()).toContain("export declare function dp_Int(receiver: Int): Dp;");
  });

  it("declare material3's composables", () => {
    expect(text()).toMatch(
      /export declare function Text\(props: \{ text: string; modifier\?: Modifier; color\?: Color;/,
    );
    expect(text()).toMatch(
      /export declare function Button\(props: \{ onClick: \(\) => void; modifier\?: Modifier;[^\n]*; children: ScopedChildren<RowScope> \}\): Composed;/,
    );
  });

  it("leave an empty vararg to Kotlin: rememberSaveable's inputs", () => {
    expect(text()).toContain(
      "export declare function rememberSaveable<T>(init: () => T, options?: { saver?: Saver<T, unknown>; key?: string | null }): T;",
    );
    expect(text()).toContain("export declare function isSystemInDarkTheme(): boolean;");
    // Not where it would call another overload: LaunchedEffect's keyless one Kotlin refuses,
    // remember's own without keys.
    expect(text()).not.toContain("export declare function LaunchedEffect(block:");
    expect(text()).not.toContain("remember_2");
  });

  it("name the scopes lambdas run in: their first parameter", () => {
    // A scope's member extensions of Modifier start from the scope's Modifier.
    expect(block("interface RowScope")).toContain("\n  readonly Modifier: RowScope_Modifier;");
    expect(block("interface RowScope_Modifier extends Modifier")).toMatch(
      /\n {2}weight\(weight: Float/,
    );
    expect(block("interface BoxScope_Modifier extends Modifier")).toMatch(
      /\n {2}align\(alignment: Alignment\): this;/,
    );
    // A scope's extensions are its methods, a composable showing UI an element: <column.AnimatedVisibility>.
    expect(block("interface ColumnScope")).toMatch(
      /\n {2}AnimatedVisibility\(props: \{ visible: boolean;[^\n]*; children: ScopedChildren<AnimatedVisibilityScope> \}\): Composed;/,
    );
    // A lazy list's items are elements of its scope, whose content gets the item's scope, then the item.
    expect(block("interface LazyListScope")).toContain(
      "\n  items<T>(props: { items: T[]; key?: ((arg0: T) => unknown) | null; contentType?: (arg0: T) => unknown; children: (scope: LazyItemScope, arg0: T) => Shown }): Composed;",
    );
    expect(block("interface LazyListScope")).toContain(
      "\n  item(props: { key?: unknown; contentType?: unknown; children: ScopedChildren<LazyItemScope> }): Composed;",
    );
    // A callback with a receiver whose scope has elements: LazyColumn's content, which gives its items.
    expect(text()).toMatch(
      /export declare function LazyColumn\(props: \{ modifier\?: Modifier;[^\n]*; children: \(scope: LazyListScope\) => Shown \}\): Composed;/,
    );
    // One whose scope has none stays a callback: Canvas draws in DrawScope.
    expect(text()).toContain(
      "export declare function Canvas(props: { modifier: Modifier; onDraw: (scope: DrawScope) => void }): Composed;",
    );
  });

  it("give callbacks their arguments, and leave to Kotlin the defaults content cannot write", () => {
    // Switch calls back with its new state.
    expect(text()).toContain(
      "export declare function Switch(props: { checked: boolean | Bound<boolean>; onCheckedChange?: ((arg0: boolean) => void) | null; modifier?: Modifier; thumbContent?: Content | null;",
    );
    // BasicTextField's decorationBox (a composable lambda given a composable one): its default.
    // Its value and onValueChange are paired: a bound signal gives both.
    expect(text()).toContain(
      "export declare function BasicTextField(props: { value: string | Bound<string>; onValueChange?: (arg0: string) => void; modifier?: Modifier;",
    );
  });
});

describe.skipIf(!android)("content written from the bindings", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it("keep the toggle's Kotlin", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result, text } = compileApp(TOGGLE);

    expect(result.diagnostics).toEqual([]);
    expect(text).toContain("Modifier.offset(x = knob.value).padding(all = 3.0.dp)");
    expect(text).toContain("DisposableEffect(key1 = true) {");
    expect(text).toContain("onDispose { lucent.left");
  }, 300_000);

  it("write each parameter as its binding says: names, content, callbacks and number types", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result, text } = compileApp(SLICE);

    expect(result.diagnostics).toEqual([]);
    // Int and Float parameters, Float through State<Float> and Animatable<Float, …>.
    expect(text).toContain("tween(durationMillis = 300)");
    expect(text).toContain("Modifier.size(size = size.value).alpha(alpha = fade.value)");
    expect(text).toContain("remember { Animatable(initialValue = 0f) }");
    expect(text).toContain(
      "wobble.animateTo(targetValue = 8f, animationSpec = spring(dampingRatio = Spring.DampingRatioHighBouncy))",
    );
    // A Float where a Double is taken (Double.dp) is converted.
    expect(text).toContain("Modifier.offset(x = wobble.value.toDouble().dp)");
    // Statics of a class and of an object.
    expect(text).toContain("verticalArrangement = Arrangement.spacedBy(space = 8.0.dp)");
    expect(text).toContain("Row(verticalAlignment = Alignment.CenterVertically) {");
    expect(text).toContain(
      "Image(painter = ColorPainter(color = tint.value), contentDescription = null, modifier =",
    );
    expect(text).toContain("Spacer(modifier = Modifier.width(width = 8.0.dp))");
    // The callback given last is Kotlin's trailing lambda, the content after the named arguments.
    expect(text).toMatch(/\.clickable \{ lucent\.tap\d+\(\) \}\.scale\(scale = fade\.value\)/);
    expect(text).toMatch(/contentAlignment = Alignment\.Center\) \{ Text\(text = /);
    // material3: a callback among the named arguments, then the content.
    expect(text).toMatch(/Button\(onClick = \{ lucent\.tap\d+\(\) \}\) \{ Text\(text = "Tap"\) \}/);
    expect(text).toContain("import androidx.compose.material3.Button");
    expect(text).toContain("import androidx.compose.foundation.layout.Arrangement");
    expect(text).toContain("import androidx.compose.ui.draw.alpha");
  }, 300_000);

  it("keep a number's Kotlin type through a generic result (rememberSaveable's T)", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const files = withContent(
      "  const count = rememberSaveable(() => 3);\n  const spin = rememberSaveable(() => Animatable(0));\n\n  return <Box modifier={Modifier.alpha(spin.value).scale(count)} />;",
      { compose: ["rememberSaveable"] },
    );
    const { result, text } = compileApp(files);

    expect(result.diagnostics).toEqual([]);
    // A JavaScript number is a Double; an Animatable<Float, …>'s value stays a Float.
    expect(text).toContain("val count = rememberSaveable { 3.0 }");
    expect(text).toContain("val spin = rememberSaveable { Animatable(initialValue = 0f) }");
    expect(text).toContain("Modifier.alpha(alpha = spin.value).scale(scale = count.toFloat())");
  }, 300_000);

  it("refuse what the bindings leave out", () => {
    process.env.LUCENT_VIEWS = "fabric";

    const { result } = compileApp(
      withContent("  return <Column modifier={Modifier.weight(1)}>{null}</Column>;"),
    );

    expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toContainEqual(
      expect.stringMatching(/^LUCENT9001 .*Property 'weight' does not exist on type 'Modifier'/),
    );
  }, 300_000);

  it.skipIf(!kotlin || "missing" in artifacts)(
    "compile the slice's Kotlin with the Compose compiler, warnings as errors",
    () => {
      if ("missing" in artifacts) return;
      process.env.LUCENT_VIEWS = "fabric";

      const { dir, text } = compileApp(SLICE);
      const classpath = kotlinClasspath(artifacts, dir);
      const source = path.join(dir, "Slice.kt");
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
        `-Xplugin=${path.join(kotlin!.lib, "compose-compiler-plugin.jar")}`,
        "-cp",
        classpath!.join(path.delimiter),
        source,
        ...runtime,
        "-d",
        path.join(dir, "slice.jar"),
      ]);

      expect(kotlinc.stderr).toBe("");
      expect(kotlinc.status).toBe(0);

      fs.rmSync(dir, { recursive: true, force: true });
    },
    600_000,
  );
});
