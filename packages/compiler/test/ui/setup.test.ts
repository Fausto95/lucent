// Components' setups compiled into C++ (LUCENT_VIEWS=fabric): the Meter
// fixture on both platforms, what setup code may and may not do, and the
// sources compiling against React Native's renderer headers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { compile, type CompileResult, sdkAvailable, writeNativePackage } from "../../src/index.ts";
import { METER } from "./meter-fixture.ts";
import {
  androidToolchain,
  compileErrors,
  iosHostToolchain,
  type Toolchain,
} from "./react-native-headers.ts";

const sdks = {
  ios: process.platform === "darwin" && sdkAvailable("ios"),
  android: sdkAvailable("android"),
};

/** `files` in a package `@acme/app`, compiled for `platform`; the directory too. */
function build(
  files: Record<string, string>,
  platform: "ios" | "android",
): { dir: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-setup-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const lucent = Object.keys(files).map((f) => path.join(dir, f));

  return { dir, result: compile(lucent, { platforms: [platform] }) };
}

const file = (r: CompileResult, name: string) => r.files.get(name) ?? "";

/** One component module (for iOS), `body` its setup after it makes a label. */
function label(props: string, body: string, extra = ""): Record<string, string> {
  return {
    "label.lucent.ts": `import type { UILabel } from "lucent:ios/UIKit";
import type { TextView } from "lucent:android/android.widget";

export declare function Label(props: ${props}): UILabel | TextView;
`,
    "label.ios.lucent.tsx": `import { UILabel } from "lucent:ios/UIKit";
import { effect, expose, invalidateSize, onDispose, signal } from "lucent:ui";
${extra}
export function Label(props: ${props}): UILabel {
  const label = new UILabel();
${body}
  return label;
}
`,
  };
}

describe("a component's compiled setup", () => {
  beforeEach(() => {
    process.env.LUCENT_VIEWS = "fabric";
  });

  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  for (const platform of ["ios", "android"] as const)
    it.skipIf(!sdks[platform])(
      `joins its module on ${platform}: a signal per prop, a route per event, a command table`,
      () => {
        const { result } = build(METER, platform);

        expect(result.diagnostics).toEqual([]);
        expect(result.warnings ?? []).toEqual([]);

        const header = file(result, `${platform}/m_meter.h`);

        expect(header).toContain("struct Meter_Props {");
        expect(header).toContain("lucent::ui::Signal<lucent::String> p0_title{};");
        expect(header).toContain("lucent::ui::Signal<lucent::Opt<lucent::String>> p1_subtitle{};");
        expect(header).toContain("lucent::ui::Event<bool> e0_onChange{};");
        expect(header).toContain("struct Meter_Commands {");
        expect(header).toContain("lucent::Fn<void()> c0_reset{};");
        expect(header).toContain("lucent::Fn<double()> c1_changes{};");
        expect(header).toContain(
          "lucent::NativeRef Meter_setup(lucent_app::m_meter::Meter_Props p0_, Meter_Commands& lucent_commands);",
        );

        const unit = file(result, `${platform}/m_meter.${platform === "ios" ? "mm" : "cpp"}`);

        // Effects are named by where they are, for loop reports.
        expect(unit).toMatch(
          new RegExp(
            `lucent::ui::effect\\(lucent::ui::mainGraph\\(\\), v\\d+_, "meter\\.${platform}\\.lucent\\.tsx:\\d+"\\)`,
          ),
        );
        expect(unit).toContain("props.e0_onChange(");
        // The native callback setup subscribes runs in the main context, never under the Lucent lock.
        expect(unit).toMatch(/lucent::(callNowIn|postTo)\(lucent::ExecutionContext::main\(\), /);
        expect(unit).not.toMatch(/lucent::(callNow|postCallback)\(/);
        expect(unit).toContain("lucent::ui::mainGraph()->onCleanup(");
        expect(unit).toContain("lucent_commands.c0_reset = ");
        // Every function setup makes enters its mount when it runs: its host measures what it changed.
        expect(unit).toContain("auto lucent_content = lucent::ui::activeContent();");
        expect(unit).toMatch(/lucent::Fn<void\(\)>\(lucent::ui::inContent\(lucent_content, /);
        expect(unit).not.toMatch(/lucent::Fn<[^>]*>\(\[/);

        const reg = result.components?.[0]?.registration;
        const mount = file(result, `${platform}/views/${reg}_mount.cpp`);

        expect(mount).toContain(
          "std::shared_ptr<Mount> Mount::create(const Props& props, Emit emit) {",
        );
        expect(mount).toContain("lucent_app::m_meter::Meter_setup(state->props, state->commands)");
        expect(file(result, `${platform}/views/${reg}.h`)).toContain("struct Mount {");
      },
      300_000,
    );

  const toolchains: [string, "ios" | "android", Toolchain | undefined][] = [
    // The iOS host's view class needs React Native's iOS headers too.
    ["the iOS simulator", "ios", iosHostToolchain()],
    ["Android", "android", androidToolchain()],
  ];

  for (const [name, platform, toolchain] of toolchains)
    it.skipIf(!toolchain || !sdks[platform])(
      `compiles, with its mount, against React Native's renderer headers for ${name}`,
      () => {
        const { result } = build(METER, platform);
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-setup-cc-"));

        for (const [f, text] of result.files) {
          const target = path.join(out, f);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, text);
        }

        const units = [...result.files.keys()]
          .filter((f) => /\.(cpp|mm)$/.test(f) && !f.endsWith("lucent_identity.cpp"))
          .map((f) => path.join(out, f));
        // The app builds Lucent's modules without -Werror; parameters it leaves unused are no error there.
        const args = [
          ...toolchain!.args,
          "-Wno-unused-variable",
          ...(platform === "ios" ? ["-fobjc-arc"] : []),
        ];

        expect(compileErrors({ ...toolchain!, args }, path.join(out, platform), units)).toBe("");

        fs.rmSync(out, { recursive: true, force: true });
      },
      300_000,
    );

  it.skipIf(!sdks.ios)(
    "delivers each event as lucent:ui marks it, and calls a marked event like any other",
    () => {
      const props =
        "{ text: string; onDrag?: Coalesced<(offset: number) => void>; onPick?: Continuous<() => void>; onDone?: () => void }";
      const { result } = build(
        {
          "label.lucent.ts": `import type { UILabel } from "lucent:ios/UIKit";
import type { TextView } from "lucent:android/android.widget";
import type { Coalesced, Continuous } from "lucent:ui";

export declare function Label(props: ${props}): UILabel | TextView;
`,
          "label.ios.lucent.tsx": `import { UILabel } from "lucent:ios/UIKit";
import { type Coalesced, type Continuous, effect } from "lucent:ui";

export function Label(props: ${props}): UILabel {
  const label = new UILabel();

  effect(() => {
    label.text = props.text;
    props.onDrag?.(props.text.length);
    props.onPick?.();
    props.onDone?.();
  });

  return label;
}
`,
        },
        "ios",
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.components?.[0]?.events.map((e) => [e.name, e.delivery])).toEqual([
        ["onDrag", "coalesced"],
        ["onPick", "continuous"],
        ["onDone", "discrete"],
      ]);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "warns of a prop read once, while it sets up",
    () => {
      const { result } = build(
        label(
          "{ text: string }",
          "  const first = props.text;\n  effect(() => {\n    label.text = first;\n  });\n",
        ),
        "ios",
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.warnings?.map((w) => [w.code, w.message])).toEqual([
        [
          "LUCENT3021",
          "`props.text` is read once, while `Label` sets up: later commits never reach what it gives the value to. Read it inside `effect(() => …)`, or in the handler that needs it",
        ],
      ]);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "refuses an event used as a value: JavaScript answers it later",
    () => {
      const { result } = build(
        label(
          "{ text: string; onTap?: () => void }",
          "  expose({ listens: (): boolean => props.onTap !== undefined });\n",
        ),
        "ios",
      );

      expect(result.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
        "LUCENT3021",
        "`props.onTap` is an event: JavaScript handles it later, so it gives no value back and is not a function here. Call it where the event happens (`props.onTap?.(…)`), and give the view what it needs as a prop",
      ]);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "refuses the props used as a whole",
    () => {
      const { result } = build(
        label(
          "{ text: string }",
          "  keep(props);\n",
          "function keep(_p: { text: string }): void {}\n",
        ),
        "ios",
      );

      expect(result.diagnostics.map((d) => d.message)).toContainEqual(
        "`Label` uses `props` as a whole: setup runs once, so a copy of the props would keep their first values. Read each prop where it is used (`props.value`)",
      );
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "takes props of every view type: an array's signal holds a Lucent array",
    () => {
      const { result } = build(label("{ items: string[] }", ""), "ios");

      expect(result.diagnostics).toEqual([]);
      expect(result.files.get("ios/m_label.h")).toContain(
        "lucent::ui::Signal<lucent::Array<lucent::String>> p0_items{};",
      );
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "refuses a Lucent class given to the platform: its methods would run in module code",
    () => {
      const { result } = build(
        {
          "field.lucent.ts": `import type { UITextField } from "lucent:ios/UIKit";
import type { EditText } from "lucent:android/android.widget";

export declare function Field(props: { text: string }): UITextField | EditText;
`,
          "field.ios.lucent.tsx": `import { UITextField, type UITextFieldDelegate } from "lucent:ios/UIKit";

class Edits implements UITextFieldDelegate {
  textFieldDidEndEditing(_field: UITextField): void {}
}

export function Field(props: { text: string }): UITextField {
  const field = new UITextField({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  field.delegate = new Edits();
  return field;
}
`,
        },
        "ios",
      );

      expect(result.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
        "LUCENT3021",
        "a view gives the platform `Edits`, whose methods would run in module code (holding the Lucent lock), not on the view's main thread: give the platform a function instead",
      ]);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "hashes its contract into its module's API: a changed prop changes it, a changed setup does not",
    () => {
      const api = (props: string, body: string) => {
        const { result } = build(label(props, body), "ios");

        expect(result.diagnostics).toEqual([]);
        return result.identity!.apis.ios!.label;
      };
      const base = api("{ text: string }", "");

      expect(api("{ text: string }", '  label.text = "set up";\n')).toBe(base);
      expect(api("{ text: string; size?: number | null }", "")).not.toBe(base);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "gives the app its React declarations",
    () => {
      const { dir, result } = build(label("{ text: string; onTap?: () => void }", ""), "ios");

      expect(result.diagnostics).toEqual([]);

      const types = result.componentTypes?.get("label") ?? "";

      expect(types).toContain("export declare function Label(props: {");
      expect(types).toContain("onTap?: () => void;");

      const out = path.join(dir, "native");
      writeNativePackage(result, out);

      expect(fs.readFileSync(path.join(out, "types/views/label.d.ts"), "utf8")).toBe(types);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "refuses effects that touch module state: they run on the main thread",
    () => {
      const { result } = build(
        label(
          "{ text: string }",
          "  effect(() => {\n    shown++;\n    label.text = props.text;\n  });\n",
          "let shown = 0;\n",
        ),
        "ios",
      );

      expect(result.diagnostics.map((d) => d.code)).toContain("LUCENT3022");
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "marks its size changed from code after an await, which enters no mount",
    () => {
      const { result } = build(
        label(
          "{ text: string }",
          [
            "  expose({",
            "    later: async (more: string) => {",
            "      await delay(10);",
            "      label.text = more;",
            "      invalidateSize();",
            "    },",
            "  });",
            "",
          ].join("\n"),
          'import { delay } from "lucent:core";\n',
        ),
        "ios",
      );

      expect(result.diagnostics).toEqual([]);

      const unit = file(result, "ios/m_label.mm");

      expect(unit).toContain("auto lucent_content = lucent::ui::activeContent();");
      // The coroutine keeps the mount's content in its frame, with its other captures.
      expect(unit).toMatch(
        /\[\]\([^)]*auto lucent_content[^)]*\).*lucent::ui::invalidateSize\(lucent_content\)/s,
      );
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "keeps lucent:ui's helpers to setups",
    () => {
      const { result } = build(
        {
          "m.ios.lucent.ts": `import { effect } from "lucent:ui";

export function watch(): void {
  effect(() => {});
}
`,
          "m.lucent.ts": "export declare function watch(): void;\n",
        },
        "ios",
      );

      expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
        [
          "LUCENT3021",
          "effect is for a component's setup: call it in an exported function of a .lucent.tsx module that returns a view, or in a function that setup creates",
        ],
      ]);
    },
    300_000,
  );
});
