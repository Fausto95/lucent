// React children of a Lucent component (LUCENT_VIEWS=fabric): a
// `children: Children` prop, and the slot setup asks its host for and puts
// in its view. Compiled on both platforms, down to what each host gets.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { compile, type CompileResult, sdkAvailable, writeNativePackage } from "../../src/index.ts";
import {
  androidToolchain,
  compileErrors,
  iosHostToolchain,
  type Toolchain,
} from "./react-native-headers.ts";
import { CARD } from "./card-fixture.ts";

const sdks = {
  ios: process.platform === "darwin" && sdkAvailable("ios"),
  android: sdkAvailable("android"),
};

/** `files` in a package `@acme/app`, compiled for `platform`; the directory too. */
function build(
  files: Record<string, string>,
  platform: "ios" | "android" | "host",
): { dir: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-children-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const lucent = Object.keys(files).map((f) => path.join(dir, f));

  return { dir, result: compile(lucent, { platforms: [platform] }) };
}

/** One file for both platforms: each PLATFORM branch makes its slot and returns its views. */
const ONE_FILE_CARD = {
  "card.lucent.tsx": `import { PLATFORM } from "lucent:platform";
import type { ViewGroup } from "lucent:android/android.view";
import { LinearLayout, TextView } from "lucent:android/android.widget";
import { UILabel, UIStackView, UIView } from "lucent:ios/UIKit";
import { type Children, slot } from "lucent:ui";

export function Card(props: { title: string; children?: Children }) {
  if (PLATFORM === "ios") {
    const content = slot<UIView>();

    return (
      <UIStackView>
        <UILabel text={props.title} />
        <UIView create={() => content} />
      </UIStackView>
    );
  }

  const content = slot<ViewGroup>();

  return (
    <LinearLayout>
      <TextView text={props.title} />
      <LinearLayout create={() => content as LinearLayout} />
    </LinearLayout>
  );
}
`,
};

const file = (r: CompileResult, name: string) => r.files.get(name) ?? "";

describe("a component's React children", () => {
  beforeEach(() => {
    process.env.LUCENT_VIEWS = "fabric";
  });

  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  for (const platform of ["ios", "android"] as const)
    it.skipIf(!sdks[platform])(
      `reach setup as the slot its ${platform} host makes, which setup places`,
      () => {
        const { result } = build(CARD, platform);

        expect(result.diagnostics).toEqual([]);

        const card = result.components?.[0];

        expect(card?.children).toEqual({ optional: true });
        expect(card?.props.map((p) => p.name)).toEqual(["title"]);

        // Setup gets the host's slot; `slot()` is that view.
        expect(file(result, `${platform}/m_card.h`)).toContain(
          "lucent::NativeRef Card_setup(lucent_app::m_card::Card_Props p0_, Card_Commands& lucent_commands, lucent::NativeRef lucent_slot);",
        );
        expect(file(result, `${platform}/m_card.${platform === "ios" ? "mm" : "cpp"}`)).toContain(
          "lucent::NativeRef content = lucent_slot;",
        );

        const reg = card!.registration;
        const header = file(result, `${platform}/views/${reg}.h`);
        const mount = file(result, `${platform}/views/${reg}_mount.cpp`);

        expect(header).toContain(
          "static std::shared_ptr<Mount> create(const Props& props, Emit emit, lucent::NativeRef slot);",
        );
        expect(mount).toContain(
          "std::shared_ptr<Mount> Mount::create(const Props& props, Emit emit, lucent::NativeRef slot) {",
        );
        expect(mount).toContain(
          "lucent_app::m_card::Card_setup(state->props, state->commands, slot)",
        );

        // Laid out by Yoga as a container of its children, not measured as a leaf.
        expect(header).toContain(
          "using ShadowNode = lucent::views::SlotShadowNode<ComponentName, Props, EventEmitter>;",
        );

        const host = file(
          result,
          `${platform}/views/${reg}${platform === "ios" ? "ComponentView.mm" : "_android.cpp"}`,
        );

        expect(host).toMatch(/mount_\(Mount::create\(props, [\s\S]*, host\.slot\(\)\)\)/);
      },
      300_000,
    );

  it.skipIf(!sdks.ios)(
    "make the iOS host keep a slot for the component",
    () => {
      const { result } = build(CARD, "ios");
      const reg = result.components![0]!.registration;

      expect(file(result, `ios/views/${reg}ComponentView.mm`)).toMatch(
        /\+ \(BOOL\)lucentTakesChildren \{\s*return YES;\s*\}/,
      );
    },
    300_000,
  );

  it.skipIf(!sdks.android)(
    "make the Android manager's views keep a slot for the component",
    () => {
      const { dir, result } = build(CARD, "android");
      const reg = result.components![0]!.registration;
      const out = path.join(dir, "native");

      writeNativePackage(result, out);

      const manager = fs.readFileSync(
        path.join(out, `android/src/main/java/dev/lucent/generated/${reg}Manager.java`),
        "utf8",
      );

      expect(manager).toContain(`super("${reg}", true);`);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "are React's: the declarations take them, the proxy passes them on",
    () => {
      const { result } = build(CARD, "ios");

      expect(result.componentTypes?.get("card")).toContain("children?: ReactNode;");
      expect(result.proxies.get("card")).toContain("children: true,");
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "are never read by setup: React Native mounts them in the slot",
    () => {
      const { result } = build(
        {
          ...CARD,
          "card.ios.lucent.tsx": CARD["card.ios.lucent.tsx"]!.replace(
            'card.alpha = props.title === "" ? 0.5 : 1;',
            "card.alpha = props.children === undefined ? 1 : 0.5;",
          ),
        },
        "ios",
      );

      expect(result.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
        "LUCENT3021",
        "`props.children` are React's: React Native mounts them in the view `slot()` gave `Card`, and setup never reads them",
      ]);
    },
    300_000,
  );

  for (const platform of ["ios", "android"] as const)
    it.skipIf(!sdks.ios || !sdks.android)(
      `reach a one-file component through the slot its ${platform} branch makes`,
      () => {
        const { result } = build(ONE_FILE_CARD, platform);

        expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
        expect(result.components?.[0]?.children).toEqual({ optional: true });
      },
      300_000,
    );

  it.skipIf(!sdks.ios || !sdks.android)(
    "reach a one-file component's slots on the host, one per PLATFORM branch",
    () => {
      const { result } = build(ONE_FILE_CARD, "host");

      expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    },
    300_000,
  );

  for (const platform of ["ios", "android"] as const)
    it.skipIf(!sdks.ios || !sdks.android)(
      `reach a one-file component through the slot its switch (PLATFORM) case for ${platform} makes`,
      () => {
        const { result } = build(
          {
            "card.lucent.tsx": ONE_FILE_CARD["card.lucent.tsx"]
              .replace('  if (PLATFORM === "ios") {', '  switch (PLATFORM) {\n  case "ios": {')
              .replace("    );\n  }\n\n  const content", "    );\n  }\n  default: {\n  const content")
              .replace("    </LinearLayout>\n  );\n}", "    </LinearLayout>\n  );\n  }\n  }\n}"),
          },
          platform,
        );

        expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
        expect(result.components?.[0]?.children).toEqual({ optional: true });
      },
      300_000,
    );

  it.skipIf(!sdks.ios || !sdks.android)(
    "refuse a slot made under a PLATFORM test with a condition of setup's",
    () => {
      const { result } = build(
        {
          "card.lucent.tsx": ONE_FILE_CARD["card.lucent.tsx"]
            .replace('  if (PLATFORM === "ios") {', '  if (PLATFORM === "ios" && props.title !== "") {')
            .replace(
              "    );\n  }\n\n  const content",
              '    );\n  }\n\n  if (PLATFORM === "ios") return <UILabel text="none" />;\n\n  const content',
            ),
        },
        "ios",
      );

      expect(result.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
        "LUCENT3021",
        expect.stringContaining("`Card` calls slot outside a declaration"),
      ]);
    },
    300_000,
  );

  it.skipIf(!sdks.ios)(
    "still refuse a slot made under a condition of setup's",
    () => {
      const { result } = build(
        {
          ...CARD,
          "card.ios.lucent.tsx": CARD["card.ios.lucent.tsx"]!.replace(
            "  const content = slot<UIView>();\n\n  card.backgroundColor = UIColor.systemYellow;\n  card.addSubview(content);",
            '  card.backgroundColor = UIColor.systemYellow;\n\n  if (props.title !== "") {\n    const content = slot<UIView>();\n\n    card.addSubview(content);\n  }',
          ),
        },
        "ios",
      );

      expect(result.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
        "LUCENT3021",
        expect.stringContaining("`Card` calls slot outside a declaration"),
      ]);
    },
    300_000,
  );

  const toolchains: [string, "ios" | "android", Toolchain | undefined][] = [
    ["the iOS simulator", "ios", iosHostToolchain()],
    ["Android", "android", androidToolchain()],
  ];

  for (const [name, platform, toolchain] of toolchains)
    it.skipIf(!toolchain || !sdks[platform])(
      `compile, with the host glue, against React Native's renderer headers for ${name}`,
      () => {
        const { result } = build(CARD, platform);
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-children-cc-"));

        expect(result.diagnostics).toEqual([]);

        for (const [f, text] of result.files) {
          const target = path.join(out, f);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, text);
        }

        const units = [...result.files.keys()]
          .filter((f) => /\.(cpp|mm)$/.test(f) && !f.endsWith("lucent_identity.cpp"))
          .map((f) => path.join(out, f));
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
});
