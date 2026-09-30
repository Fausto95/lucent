import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { compile, runtimeDir, sdkAvailable, type SdkOptions } from "../src/index.ts";
import { kotlinClasspath } from "./android-harness.ts";
import { METER } from "./ui/meter-fixture.ts";
import { androidToolchain, compileErrors } from "./ui/react-native-headers.ts";

const android = sdkAvailable("android");
const kotlin = kotlinToolchain();

/** A label whose events take no argument, and one: `onReset()` as well as `onChange(value)`. */
const GAUGE = {
  "gauge.lucent.ts": `import type { TextView } from "lucent:android/android.widget";

export type Props = { value: number; onChange?: (value: number) => void; onReset?: () => void };

export declare function Gauge(props: Props): TextView;
`,
  "gauge.android.lucent.tsx": `import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { effect, expose } from "lucent:ui";
import type { Props } from "./gauge.lucent";

export function Gauge(props: Props): TextView {
  const text = new TextView(appContext());

  effect(() => {
    text.setText(String(props.value));
  });

  text.setOnClickListener(() => props.onChange?.(props.value));

  expose({
    reset: () => {
      text.setText("");
      props.onReset?.();
    },
  });

  return text;
}
`,
};

/** A label with props only: no event, no command. */
const CAPTION = {
  "caption.lucent.ts": `import type { TextView } from "lucent:android/android.widget";

export type Props = { text: string };

export declare function Caption(props: Props): TextView;
`,
  "caption.android.lucent.tsx": `import { appContext } from "lucent:android";
import { TextView } from "lucent:android/android.widget";
import { effect } from "lucent:ui";
import type { Props } from "./caption.lucent";

export function Caption(props: Props): TextView {
  const label = new TextView(appContext());

  effect(() => {
    label.setText(props.text);
  });

  return label;
}
`,
};

/** `files` (the Meter fixture by default: a toggle button, an event, a command and a request), for Android. */
function compileApp(files: Record<string, string> = METER, sdk?: SdkOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-android-views-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const lucent = Object.keys(files).map((f) => path.join(dir, f));

  return { dir, result: compile(lucent, { platforms: ["android"], sdk }) };
}

const HOST = /^android\/views\/(LucentMeter_[0-9a-f]{12})_android\.cpp$/;

describe("components' Android hosts", () => {
  afterEach(() => {
    delete process.env.LUCENT_VIEWS;
  });

  it.skipIf(!android)(
    "give each component's mount to the Android host",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { result } = compileApp();

      expect(result.diagnostics).toEqual([]);

      const files = [...result.files.keys()];
      const registration = files.map((f) => HOST.exec(f)).find((m) => m)?.[1];

      expect(registration).toBeDefined();

      // The host drives the compiled Mount (as iOS's LucentMounted does): nothing runs setup again.
      const host = result.files.get(`android/views/${registration}_android.cpp`) ?? "";

      expect(host).toContain("struct LucentMounted final : public lucent::views::Mounted");
      expect(host).toContain("mount_(Mount::create(props, ");
      expect(host).toContain("mount_->dispose();");
      expect(host).toContain("mount_->command(parseCommand(name, args), ");
      expect(result.files.get("android/views/lucent_hosts.cpp")).toContain(
        `{"${registration}", &lucent::views::${registration}::mount, &lucent::views::${registration}::requestIdOf}`,
      );
      expect(files.some((f) => f.endsWith("ComponentView.mm"))).toBe(false);
    },
    300_000,
  );

  it.skipIf(!android)(
    "give the Android host its mount where the iOS SDK is missing, the declaration's iOS view untyped",
    () => {
      process.env.LUCENT_VIEWS = "fabric";

      const { result } = compileApp(METER, {
        ios: { xcrun: path.join(os.tmpdir(), "no-such-xcrun") },
      });

      expect(result.diagnostics).toEqual([]);
      expect([...result.files.keys()].some((f) => HOST.test(f))).toBe(true);
    },
    300_000,
  );

  it.skipIf(!android)(
    "leave the Android host out while the switch is off",
    () => {
      const { result } = compileApp();

      expect([...result.files.keys()].filter((f) => f.includes("/views/"))).toEqual([]);
    },
    300_000,
  );

  /**
   * The platform keeps a Kotlin function it is given and may call it back
   * during any native call, a component's included, as DataStore does the
   * transactions of the example app's port.
   */
  describe.skipIf(!android || !kotlin)(
    "next to a module whose kept callback uses module state",
    () => {
      let sdk: SdkOptions;

      beforeAll(async () => {
        sdk = await kotlinClasspath(kotlin!);
      }, 300_000);

      const RESULTS = {
        "results.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { SearchClient } from "lucent:android/dev.orbit.search";

let client: SearchClient | undefined;
let hits = 0;

export function listen(): number {
  if (PLATFORM === "android") {
    client ??= new SearchClient("https://orbit.invalid", null);
    client.onResult(() => {
      hits++;
    });
  }

  return hits;
}
`,
      };

      it("accept the component: the callback runs in the module context its glue enters", () => {
        process.env.LUCENT_VIEWS = "fabric";

        const { result } = compileApp({ ...CAPTION, ...RESULTS }, sdk);

        expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
        expect(result.components?.map((c) => c.export)).toEqual(["Caption"]);
      }, 300_000);

      it("still refuse a component whose setup uses that module state itself", () => {
        process.env.LUCENT_VIEWS = "fabric";

        const caption = CAPTION["caption.android.lucent.tsx"]
          .replace(
            "import type { Props }",
            `import { listen } from "./results.lucent";\nimport type { Props }`,
          )
          .replace("label.setText(props.text);", "label.setText(`${listen()} ${props.text}`);");
        const { result } = compileApp(
          { ...CAPTION, ...RESULTS, "caption.android.lucent.tsx": caption },
          sdk,
        );

        const refused = result.diagnostics.filter((d) => d.code === "LUCENT3022");

        expect(refused.map((d) => d.message)).toContainEqual(
          expect.stringMatching(/calls `listen` .*, which reads module state `hits`/),
        );
      }, 300_000);
    },
  );

  const toolchain = androidToolchain();

  for (const [name, files] of [
    ["the Meter", METER],
    ["a component whose event takes no argument", GAUGE],
    ["a component without events or commands", CAPTION],
  ] as const)
    it.skipIf(!android || !toolchain)(
      `compile with the Android host against React Native's headers: ${name}`,
      () => {
        process.env.LUCENT_VIEWS = "fabric";

        const { dir, result } = compileApp(files);

        expect(result.diagnostics).toEqual([]);
        const out = path.join(dir, "generated");

        for (const [name, text] of result.files) {
          fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
          fs.writeFileSync(path.join(out, name), text);
        }

        const sources = [...result.files.keys()]
          .filter((f) => f.startsWith("android/") && f.endsWith(".cpp"))
          .filter((f) => !f.endsWith("lucent_identity.cpp"))
          .map((f) => path.join(out, f));
        const host = path.join(runtimeDir(), "cpp/rn/LucentViewsAndroid.cpp");
        // The flags the Android build compiles generated code with (CMakeLists.txt).
        const lucent = {
          command: toolchain!.command,
          args: [
            ...toolchain!.args,
            "-Wno-unused-variable",
            `-I${path.join(out, "android")}`,
            `-I${path.join(runtimeDir(), "native/android/include")}`,
          ],
        };

        expect(compileErrors(lucent, path.join(out, "android"), [...sources, host])).toBe("");

        fs.rmSync(dir, { recursive: true, force: true });
      },
      600_000,
    );
});
