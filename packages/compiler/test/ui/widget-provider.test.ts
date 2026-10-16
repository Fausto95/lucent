/**
 * A widget's provider (decision 0124): the class lucent.json's widget names
 * as its `provider`, whose `placeholder()`, `snapshot()` and `timeline()`
 * mirror WidgetKit's TimelineProvider. The widget's build writes its glue,
 * C functions running each method on the provider's module's actor and
 * giving its entries with their body's values, and the Swift WidgetKit
 * takes: the entry, a TimelineProvider calling the glue, and the Widget,
 * which the target's entry point (in ios-extensions.json) names from its
 * `@main` bundle. The Swift builds against the miniature SwiftUI and
 * WidgetKit with the glue's header, and the entry point against it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveNative, writeNativePackage } from "../../src/index.ts";
import { miniSwiftUI } from "./mini-swiftui.ts";
import { buildWeather, errors, PROVIDER, widgetSwiftErrors } from "./widget-fixture.ts";

const mini = miniSwiftUI();

const GALLERY = {
  displayName: "Forecast",
  description: "Today in Lisbon",
  families: ["systemSmall", "systemMedium"],
};

describe.skipIf(!mini)("a widget's provider", () => {
  it("is called through its glue, from the Swift WidgetKit takes", () => {
    const built = buildWeather(mini!.set, { widget: GALLERY });
    expect(errors(built.result)).toEqual([]);

    const files = built.result.files;
    const header = files.get("ios-extensions/Weather/widgets/Weather.h")!;
    expect(header).toContain("void* lucent_widget_Weather_placeholder(void** error);");
    expect(header).toContain(
      "void lucent_widget_Weather_snapshot(void* context, void (*done)(void* context, void* entry, void* error));",
    );
    expect(header).toContain(
      "void lucent_widget_Weather_timeline(void* context, void (*done)(void* context, void* timeline, void* error));",
    );

    const glue = files.get("ios-extensions/Weather/widgets/Weather.mm")!;
    expect(glue).toContain('#include "Weather.h"');
    expect(glue).toContain('#include "../m_lucent_u2d_weather_u2f_forecasts.h"');
    expect(glue).toContain("lucent_app::C_Forecasts::create()");
    // Each method on its module's actor, as an entry point runs it.
    expect(glue).toMatch(
      /lucent::entries::call\(&lucent_app::initModules, lucent_app::actor_\d+\(\), &failed,/,
    );
    expect(glue).toContain("out = lucentEntry(lucentProvider()->placeholder());");
    expect(glue).toContain("lucent::entries::callAsync<lucent::Ref<lucent_app::S_Entry>>(");
    expect(glue).toContain("[&] { return lucentProvider()->timeline(); },");
    // Each entry with its body's values, its date in seconds.
    expect(glue).toContain(
      "id values = lucent::objc::unwrap(lucent_app::m_lucent_u2d_weather_u2f_weather::Forecast_widget(entry));",
    );
    expect(glue).toContain("return @[ @(entry->date->getTime() / 1000), values ];");
    expect(glue).toContain(
      "out = @[ entries, timeline->reloadAfter.has() ? (id)@(timeline->reloadAfter.get()->getTime() / 1000) : (id)[NSNull null] ];",
    );

    const swift = files.get("ios-extensions/Weather/widgets/Weather.swift")!;
    expect(swift).toContain("import WidgetKit");
    expect(swift).toContain("fileprivate struct LucentWidget_Weather_Entry: TimelineEntry {");
    expect(swift).toContain("fileprivate struct LucentWidget_Weather_Provider: TimelineProvider {");
    expect(swift).toContain("lucent_widget_Weather_timeline(call, lucent_widget_Weather_settle)");
    expect(swift).toContain("public struct LucentWidget_Weather: Widget {");
    expect(swift).toContain(
      'StaticConfiguration(kind: "Weather", provider: LucentWidget_Weather_Provider()) { entry in',
    );
    expect(swift).toContain('.configurationDisplayName("Forecast")');
    expect(swift).toContain('.description("Today in Lisbon")');
    expect(swift).toContain(".supportedFamilies([.systemSmall, .systemMedium])");

    // Its target: an extension of WidgetKit's, whose entry point is the widget's bundle.
    const out = path.join(built.dir, ".lucent/native");
    const native = resolveNative([
      { name: "lucent-weather", version: "1.0.0", dir: built.dir, sources: built.dir },
    ]);
    writeNativePackage(built.result, out, { root: built.dir, native });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "ios-extensions.json"), "utf8"));
    const [weather] = manifest.extensions;
    expect(weather).toMatchObject({
      name: "Weather",
      kind: "widget",
      pod: "LucentExtensions/Weather",
    });
    expect(weather.infoPlist.NSExtension).toEqual({
      NSExtensionPointIdentifier: "com.apple.widgetkit-extension",
    });
    expect(Object.keys(weather.sources)).toEqual(["LucentWidget.swift"]);
    expect(weather.sources["LucentWidget.swift"]).toContain("LucentWidget_Weather()");
    expect(widgetSwiftErrors(mini!, built, weather.sources["LucentWidget.swift"])).toBe("");

    // Its glue's header is the subspec's, which its Swift imports through the pod's module.
    const podspec = fs.readFileSync(path.join(out, "LucentExtensions.podspec"), "utf8");
    expect(podspec).toContain('"cpp/generated/ios-extensions/Weather/widgets/*.h"');
  });

  it("reloads at the end of a timeline that names no date", () => {
    const built = buildWeather(mini!.set, {
      provider: PROVIDER.replace("reloadAfter?: Date", "").replace(
        ", reloadAfter: new Date(3 * 3600000)",
        "",
      ),
    });
    expect(errors(built.result)).toEqual([]);
    expect(built.result.files.get("ios-extensions/Weather/widgets/Weather.mm")).toContain(
      "out = @[ entries, [NSNull null] ];",
    );
    expect(widgetSwiftErrors(mini!, built)).toBe("");
  });

  it("mirrors TimelineProvider's requirements for the body's entry: LUCENT3019 otherwise", () => {
    const why = (problem: string) => [
      "LUCENT3019",
      `the widget Weather's provider, lucent-weather/forecasts#Forecasts, ${problem}: a widget's provider is an exported class whose constructor takes nothing, with \`placeholder(): E\`, \`snapshot(): Promise<E>\` and \`timeline(): Promise<{ entries: E[]; reloadAfter?: Date }>\`, \`E\` its body's entry`,
    ];
    const refused = (provider: string) => errors(buildWeather(mini!.set, { provider }).result);

    expect(
      refused(
        PROVIDER.replace(
          "async snapshot(): Promise<Entry> {",
          "async snapshot(n: number): Promise<Entry> {",
        ),
      ),
    ).toEqual([why("has no `snapshot(): Promise<E>`")]);
    expect(
      refused(
        PROVIDER.replace(
          "export class Forecasts {",
          "export class Forecasts {\n  constructor(readonly city: string) {}\n",
        ),
      ),
    ).toEqual([why("has a constructor that takes parameters")]);
    expect(
      refused(PROVIDER.replace("reloadAfter?: Date }", "reloadAfter?: Date; city?: string }")),
    ).toEqual([why("has no `timeline(): Promise<{ entries: E[]; reloadAfter?: Date }>`")]);
    expect(
      refused(
        PROVIDER.replace(
          "placeholder(): Entry {\n    return today(20);",
          'placeholder(): string {\n    return "";',
        ),
      ),
    ).toEqual([why("has no `placeholder(): E`")]);
    expect(
      errors(buildWeather(mini!.set, { widget: { provider: "forecasts#Gone" } }).result),
    ).toEqual([
      why("is no class lucent-weather/forecasts exports").map((s) =>
        s.replace("forecasts#Forecasts", "forecasts#Gone"),
      ),
    ]);
  });
});
