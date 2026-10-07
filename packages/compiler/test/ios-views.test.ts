import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, runtimeDir, sdkAvailable } from "../src/index.ts";
import { compileErrors, iosHostToolchain } from "./ui/react-native-headers.ts";

const ios = process.platform === "darwin" && sdkAvailable("ios");

/** A control: every kind of prop and event argument, a command and requests; its setup runs once. */
const GAUGE = `import { UILabel } from "lucent:ios/UIKit";
import { effect, expose } from "lucent:ui";

type Point = { x: number; y?: number | null };

type Props = {
  value: number;
  label?: string | null;
  mode: "linear" | "radial";
  points?: Point[];
  onChange?: (value: number, source?: string) => void;
  onReset: () => void;
};

export function Gauge(props: Props): UILabel {
  const text = new UILabel();

  effect(() => {
    text.text = \`\${props.label ?? "gauge"}: \${props.value}\`;
    props.onChange?.(props.value, "effect");
  });

  expose({
    reset: () => {
      text.text = "reset";
      props.onReset();
    },
    measure: (unit: "pt" | "px"): number => (unit === "pt" ? props.value * 2 : props.value),
    points: async (): Promise<Point[]> => props.points ?? [],
    mode: (): "linear" | "radial" => props.mode,
    origin: (): Point => ({ x: 0, y: null }),
  });

  return text;
}

export function twice(n: number): number {
  return n * 2;
}
`;

function compileApp(source = GAUGE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ios-views-"));
  const file = path.join(dir, "gauge.ios.lucent.tsx");
  const shared = path.join(dir, "gauge.lucent.tsx");

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  fs.writeFileSync(file, source);
  fs.writeFileSync(
    shared,
    `import type { UILabel } from "lucent:ios/UIKit";

type Point = { x: number; y?: number | null };

export declare function Gauge(props: {
  value: number;
  label?: string | null;
  mode: "linear" | "radial";
  points?: Point[];
  onChange?: (value: number, source?: string) => void;
  onReset: () => void;
}): UILabel;
export declare function twice(n: number): number;
`,
  );

  return { dir, result: compile([shared, file], { platforms: ["ios"] }) };
}

const file = (r: ReturnType<typeof compileApp>["result"], pattern: RegExp) =>
  [...r.files].find(([name]) => pattern.test(name));

describe("components' iOS hosts", () => {
  it.skipIf(!ios)(
    "compile the component's setup once, into a function JavaScript does not see",
    () => {
      const { result } = compileApp();

      expect(result.diagnostics).toEqual([]);
      expect(result.warnings ?? []).toEqual([]);
      expect(result.components?.[0]?.commands.map((c) => [c.name, c.result.kind])).toEqual([
        ["reset", "enqueue"],
        ["measure", "request"],
        ["points", "request"],
        ["mode", "request"],
        ["origin", "request"],
      ]);

      const header = file(result, /^ios\/m_gauge\.h$/)?.[1] ?? "";
      const module = file(result, /^ios\/m_gauge\.mm$/)?.[1] ?? "";

      // Props of every kind are signals of Lucent values: arrays and objects too.
      expect(header).toContain(
        "lucent::ui::Signal<lucent::Opt<lucent::Array<lucent::Ref<lucent_app::S_Point>>>> p3_points{};",
      );
      expect(header).toContain(
        "lucent::NativeRef Gauge_setup(lucent_app::m_gauge::Gauge_Props p0_, Gauge_Commands& lucent_commands);",
      );
      expect(module).toContain("lucent_commands.c0_reset = ");
      expect(module).not.toContain("lucent::views::Setup");

      const bindings = file(result, /lucent_bindings\.cpp$/)?.[1] ?? "";

      expect(bindings).toContain('"twice"');
      expect(bindings).not.toContain('"Gauge"');
      expect(result.proxies.get("gauge")).toContain("exports.Gauge = lucentComponent(");
      expect(result.proxies.get("gauge")).not.toContain("exports.Gauge = m.Gauge");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "generate each component's view class: registration, mount, props, events and commands",
    async () => {
      const { result } = compileApp();
      const [name, glue] =
        file(result, /^ios\/views\/LucentGauge_[0-9a-f]{12}ComponentView\.mm$/) ?? [];
      const registration = /(LucentGauge_[0-9a-f]{12})/.exec(name ?? "")?.[1];

      expect(glue).toBeDefined();
      expect(glue).toContain(`@interface ${registration}ComponentView : LucentComponentView`);
      expect(glue).toContain(
        `[LucentComponentView lucentRegister:[${registration}ComponentView class]];`,
      );
      expect(glue).toContain(
        `facebook::react::concreteComponentDescriptorProvider<lucent::views::${registration}::ComponentDescriptor>()`,
      );

      // React Native's view reads its props as the component's own from the start (its
      // debug builds assert that a subclass sets them up).
      expect(glue).toContain("- (instancetype)initWithFrame:(CGRect)frame {");
      expect(glue).toContain(
        `_props = lucent::views::${registration}::ShadowNode::defaultSharedProps();`,
      );

      // The view mounts the component's Mount, which runs setup once, and ends it with the mount.
      expect(glue).toContain("mount_(Mount::create(props, ");
      expect(glue).toContain(
        "mount_->update(static_cast<const Props&>(props), static_cast<const Props&>(previous));",
      );
      expect(glue).toContain("mount_->dispose();");
      expect(glue).not.toContain("lucent::views::Setup");

      // Events go through the view's current emitter, dropped once the view holds another mount.
      expect(glue).toContain("host.emitter()");

      // The mount converts the commit's props and answers requests.
      const mount = file(result, /^ios\/views\/LucentGauge_[0-9a-f]{12}_mount\.cpp$/)?.[1] ?? "";

      expect(mount).toContain(`lucent::views::required(props.values.value, "Gauge's prop value")`);
      expect(mount).toContain("lucent::views::lucentArray<lucent::Ref<lucent_app::S_Point>>(");
      expect(mount).toContain("lucent::views::toJsValue(runtime, answer)");
      expect(mount).toContain("promise.onSettled(");

      await expect(glue).toMatchFileSnapshot("ui/__snapshots__/ios/GaugeComponentView.mm.snap");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "answer every request, even one that fails before it runs or reaches no mount",
    () => {
      const { result } = compileApp();
      const glue = file(result, /ComponentView\.mm$/)?.[1] ?? "";
      const mount = file(result, /_mount\.cpp$/)?.[1] ?? "";

      // An enum or object answer converts through its own toJs, which a qualified call misses.
      expect(mount).toContain("lucent::views::toJsValue(runtime, answer)");

      // Arguments that do not parse reject the request.
      expect(glue).toMatch(
        /catch \(\.\.\.\) \{\n\s+if \(auto id = requestId\(name, args\)\) \{\n\s+requester\.reject\(\*id, lucent::views::thrownMessage\(std::current_exception\(\)\)\);/,
      );

      // The host rejects a request that reaches a view with no mount.
      expect(glue).toContain("- (std::optional<double>)lucentRequestId:");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "never set up again: a commit's changes reach the mount's signals",
    () => {
      const { result } = compileApp();
      const glue = file(result, /ComponentView\.mm$/)?.[1] ?? "";
      const mount = file(result, /_mount\.cpp$/)?.[1] ?? "";

      expect(glue).not.toContain("setUp(");
      expect(mount).toContain("auto changed = props.changed(previous);");
      expect(mount).toContain("state->inbox->post(std::move(commit));");
    },
    180_000,
  );

  it.skipIf(!ios)(
    "find the commands whatever name expose is imported under",
    () => {
      const aliased = GAUGE.replace(
        'import { effect, expose } from "lucent:ui";',
        'import { effect, expose as give } from "lucent:ui";',
      ).replace("  expose({", "  give({");
      const { result } = compileApp(aliased);

      expect(result.diagnostics).toEqual([]);

      const module = file(result, /^ios\/m_gauge\.mm$/)?.[1] ?? "";

      expect(module).toContain("lucent_commands.c0_reset = ");
    },
    180_000,
  );

  const toolchain = iosHostToolchain();

  it.skipIf(!ios || !toolchain)(
    "compile, with the component's module and the shared host, against React Native's iOS headers",
    () => {
      const { dir, result } = compileApp();
      const out = path.join(dir, "out");

      for (const [name, text] of result.files) {
        fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
        fs.writeFileSync(path.join(out, name), text);
      }

      const sources = [...result.files.keys()]
        .filter((f) => f.includes("/views/") && /\.(mm|cpp)$/.test(f))
        .map((f) => path.join(out, f));
      const runtime = path.join(runtimeDir(), "cpp/rn");

      expect(
        compileErrors(toolchain!, path.join(out, "ios"), [
          ...sources,
          path.join(out, "ios/m_gauge.mm"),
          // The shared host: the component view, its children and their slot.
          ...fs
            .readdirSync(runtime)
            .filter((f) => f.endsWith(".mm"))
            .map((f) => path.join(runtime, f)),
        ]),
      ).toBe("");
    },
    300_000,
  );

  it.skipIf(!ios)(
    "accept the spike's components next to the example app's modules that keep callbacks or override UIKit",
    () => {
      const app = path.resolve(import.meta.dirname, "../../../apps/bare-example");
      const files = [
        ".views-spike/views.lucent.tsx",
        ".views-spike/views.ios.lucent.tsx",
        ".views-spike/views.android.lucent.tsx",
        "src/sdk/netInfo.lucent.ts",
        "src/demos/location/locationPermission.lucent.ts",
        // A UIViewController subclass, whose override calls a function value.
        "src/sdk/presentation.lucent.ts",
      ].map((f) => path.join(app, f));

      const result = compile(files, { platforms: ["ios"] });

      expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
      expect(result.components?.map((c) => c.export).sort()).toEqual([
        "Caption",
        "Gauge",
        "Meter",
        "Pulse",
      ]);
    },
    300_000,
  );
});
