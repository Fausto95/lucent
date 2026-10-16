/**
 * A widget's body (decision 0124): the function lucent.json's widget names
 * as its `body`, `(entry: E) => View` in SwiftUI JSX, is neither a
 * component nor a module function. The widget's build compiles it into a
 * C++ function of the entry computing each value its view shows, once, and
 * the Swift of its view, which reads them from a struct. Nothing in it
 * calls back: callbacks, bindings, signals and lists are refused. Built
 * against the miniature SwiftUI (widget-fixture.ts), whose Swift
 * type-checks.
 */
import { describe, expect, it } from "vite-plus/test";
import { miniSwiftUI } from "./mini-swiftui.ts";
import { BODY, buildWeather, DECLARATION, errors, widgetSwiftErrors } from "./widget-fixture.ts";

const mini = miniSwiftUI();

/** lucent-weather with its widget's body `body` (weather.ios.lucent.tsx), and its declaration. */
const build = (
  set: string,
  body = BODY,
  widget: object = {},
  platform: "ios" | "android" = "ios",
  declaration = DECLARATION,
) => buildWeather(set, { body, widget, platform, declaration });

describe.skipIf(!mini)("a widget's body", () => {
  it("is compiled in the widget's build: its values in C++, its view in Swift", () => {
    const built = build(mini!.set);
    expect(errors(built.result)).toEqual([]);

    const files = built.result.files;
    const swift = files.get("ios-extensions/Weather/widgets/Weather.swift")!;
    expect(swift).toContain("fileprivate struct LucentWidget_Weather_Values {");
    expect(swift).toContain("fileprivate struct LucentWidget_Weather_View: View {");
    expect(swift).toContain("let values: LucentWidget_Weather_Values");
    // Read by place from the array its C++ computes.
    expect(swift).toMatch(
      /self\.(\w+) = lucentDecodeString\(fields\[0\], "LucentWidget_Weather_Values\.\1"\)/,
    );
    expect(swift).toContain("Text(values.");
    // The helper view's values are computed where the body uses it.
    expect(swift).toMatch(/fileprivate struct \w*Line\w*: View/);
    expect(widgetSwiftErrors(mini!, built)).toBe("");

    const unit = [...files].find(
      ([f, text]) =>
        f.startsWith("ios-extensions/Weather/") &&
        !f.endsWith(".h") &&
        text.includes("Forecast_widget("),
    );
    expect(unit).toBeDefined();
    const cpp = unit![1];
    // Each value computed once, in order, encoded into the array its function returns.
    expect(cpp).toMatch(/lucent::NativeRef \w+::Forecast_widget\(/);
    expect(cpp).toContain("lucent::swiftui::record({lucent_v0, lucent_v1,");
    expect(cpp).toContain(`lucent::objc::wrap(`);
    expect(cpp).not.toContain("lucent::ui::effect");
    // Declared in its module's header, for the widget's glue to call.
    expect(
      [...files].some(
        ([f, text]) =>
          f.startsWith("ios-extensions/Weather/") &&
          f.endsWith(".h") &&
          /Forecast_widget\(/.test(text),
      ),
    ).toBe(true);
  });

  it("is no component of the app, and no function of its module", () => {
    const built = build(mini!.set);
    const app = [...built.result.files].filter(([f]) => f.startsWith("ios/"));
    expect(app.some(([f]) => f.startsWith("ios/views/"))).toBe(false);
    expect(app.filter(([, text]) => text.includes("Forecast_"))).toEqual([]);
    expect(built.result.components ?? []).toEqual([]);

    // Android's program stubs the declaration: no component either.
    const android = build(mini!.set, BODY, {}, "android").result;
    expect(errors(android)).toEqual([]);
    expect(android.components ?? []).toEqual([]);
    expect([...android.files.values()].filter((t) => /\bForecast\b/.test(t))).toEqual([]);
  });

  it("leaves out the components of its module: they're the app's", () => {
    const built = build(
      mini!.set,
      `${BODY}
export function Badge(props: { city: string }) {
  return <Text>{props.city}</Text>;
}
`,
      {},
      "ios",
      `${DECLARATION}
export declare function Badge(props: { city: string }): View;
`,
    );
    expect(errors(built.result)).toEqual([]);

    const files = [...built.result.files];
    expect(files.some(([f]) => f.startsWith("ios/views/"))).toBe(true);
    expect(
      files.filter(([f, t]) => f.startsWith("ios-extensions/") && t.includes("Badge")),
    ).toEqual([]);
  });

  it("refuses a callback, a binding, a signal and a list", () => {
    const refused = (body: string) =>
      errors(
        build(
          mini!.set,
          `import { Button, ForEach, Text, Toggle, VStack } from "lucent:swiftui";
import { bind, signal } from "lucent:ui";
import type { Entry } from "./weather.lucent";

export function Forecast(entry: Entry) {
${body}
}
`,
        ).result,
      );

    expect(
      refused(`  const tap = () => {};
  return <Text onTapGesture={tap}>{entry.city}</Text>;`),
    ).toEqual([
      [
        "LUCENT3024",
        "the widget Weather's body calls nothing back (`tap`): WidgetKit draws a widget once per entry, from what its body computes from the entry, and runs none of its code after",
      ],
    ]);
    expect(
      refused(`  const on = signal(false);
  return <Toggle isOn={bind(on)}>{entry.city}</Toggle>;`),
    ).toEqual([
      [
        "LUCENT3024",
        "signal is for a component's setup, and the widget Weather's body is drawn once per entry: WidgetKit draws what it computes from the entry, and runs none of its code after",
      ],
    ]);
    expect(
      refused(`  return (
    <ForEach data={[entry.city]} id={(c) => c}>
      {(c) => <Text>{c}</Text>}
    </ForEach>
  );`),
    ).toEqual([
      [
        "LUCENT3024",
        "the widget Weather's body shows no list (`ForEach`), for now: show each of the entry's items in a view of its own",
      ],
    ]);
  });

  it("is a function of an entry, a record with a date: LUCENT3019 otherwise", () => {
    const r = build(
      mini!.set,
      `import { Text } from "lucent:swiftui";

export function Forecast(entry: { city: string }) {
  return <Text>{entry.city}</Text>;
}
`,
    ).result;
    expect(errors(r)).toEqual([
      [
        "LUCENT3019",
        "the widget Weather's body, lucent-weather/weather#Forecast, takes `{ city: string; }`, where an entry is a record with a `date: Date`: a widget's body is an exported function of an iOS JSX file (`.ios.lucent.tsx`) that draws its entry, `(entry: E) => View`",
      ],
    ]);

    // Forecast is a component then, which takes no Date.
    const missing = build(mini!.set, BODY, { body: "weather#Gone" }).result;
    expect(errors(missing)).toContainEqual([
      "LUCENT3019",
      "the widget Weather's body, lucent-weather/weather#Gone, is no function lucent-weather/weather exports: a widget's body is an exported function of an iOS JSX file (`.ios.lucent.tsx`) that draws its entry, `(entry: E) => View`",
    ]);
  });
});
