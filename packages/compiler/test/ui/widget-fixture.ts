/**
 * lucent-weather: a package whose widget (decision 0124), `Weather`, has a
 * provider class, `forecasts#Forecasts`, and a SwiftUI body,
 * `weather#Forecast`, which draws an entry's city, temperature and sky
 * (with a helper view), its note when it has one, and its days, a list. Compiled for iOS
 * against the miniature SwiftUI (mini-swiftui.ts), whose Swift, and the
 * widget's with its glue's header, type-checks.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compile, type CompileResult } from "../../src/index.ts";
import type { MiniSwiftUI } from "./mini-swiftui.ts";

export const DECLARATION = `import type { View } from "lucent:swiftui";

export type Day = { day: string; high: number };

export type Entry = {
  date: Date;
  city: string;
  degrees: number;
  rain: boolean;
  note: string | null;
  days: Day[];
};

export declare function Forecast(entry: Entry): View;
`;

export const PROVIDER = `import type { Entry } from "./weather.lucent";

export type Forecasts_Timeline = { entries: Entry[]; reloadAfter?: Date };

function today(degrees: number): Entry {
  return {
    date: new Date(degrees * 3600000),
    city: "Lisbon",
    degrees,
    rain: false,
    note: null,
    days: [
      { day: "Mon", high: degrees + 1 },
      { day: "Tue", high: degrees + 2 },
    ],
  };
}

export class Forecasts {
  placeholder(): Entry {
    return today(20);
  }

  async snapshot(): Promise<Entry> {
    return today(21);
  }

  async timeline(): Promise<Forecasts_Timeline> {
    return { entries: [today(21), today(22)], reloadAfter: new Date(3 * 3600000) };
  }
}
`;

export const BODY = `import { Color, Font, ForEach, HStack, Text, VStack } from "lucent:swiftui";
import type { Entry } from "./weather.lucent";

function Line(props: { label: string; on: boolean }) {
  return <Text foregroundStyle={props.on ? Color.blue : Color.gray}>{props.label}</Text>;
}

export function Forecast(entry: Entry) {
  const sky = entry.rain ? "rain" : "dry";

  return (
    <VStack spacing={4}>
      <Text font={Font.headline}>{entry.city}</Text>
      <HStack>
        <Text>{\`\${entry.degrees}°\`}</Text>
        <Line label={sky} on={entry.rain} />
      </HStack>
      {entry.note !== null ? <Text>{entry.note ?? ""}</Text> : <Text>no note</Text>}
      <ForEach data={entry.days} id={(d) => d.day}>
        {(d) => <Line label={\`\${d.day}: \${d.high}°\`} on={d.high > entry.degrees} />}
      </ForEach>
    </VStack>
  );
}
`;

/** What a build of lucent-weather changes: its files, and its widget's declaration. */
export interface WeatherOptions {
  body?: string;
  provider?: string;
  declaration?: string;
  widget?: object;
  platform?: "ios" | "android";
}

/** lucent-weather compiled against schema set `set`, in a directory of its own. */
export function buildWeather(
  set: string,
  options: WeatherOptions = {},
): { dir: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-widget-"));
  const files: Record<string, string> = {
    "package.json": '{ "name": "lucent-weather", "version": "1.0.0", "lucent": {} }\n',
    "lucent.json": JSON.stringify({
      ios: {
        appExtensions: [
          {
            kind: "widget",
            name: "Weather",
            provider: "forecasts#Forecasts",
            body: "weather#Forecast",
            ...options.widget,
          },
        ],
      },
    }),
    "weather.lucent.ts": options.declaration ?? DECLARATION,
    "weather.ios.lucent.tsx": options.body ?? BODY,
    "forecasts.lucent.ts": options.provider ?? PROVIDER,
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files)
      .filter((f) => /\.lucent\.tsx?$/.test(f))
      .map((f) => path.join(dir, f)),
    {
      platforms: [options.platform ?? "ios"],
      sdk: {
        schemas: set,
        cacheDir: path.join(dir, "cache"),
        ios: { xcrun: path.join(dir, "no-xcrun") },
      },
    },
  );
  return { dir, result };
}

export const errors = (r: CompileResult) => r.diagnostics.map((d) => [d.code, d.message]);

const run = (m: MiniSwiftUI, args: string[]) =>
  spawnSync(m.swiftc[0], [...m.swiftc.slice(1), ...args], { encoding: "utf8" });

/**
 * What swiftc says of the widget's Swift, built against the miniature
 * modules as LucentExtensions with its glue's header as C (`""` when it
 * builds), and of `entry`, an extension target's source importing it.
 */
export function widgetSwiftErrors(
  m: MiniSwiftUI,
  built: { dir: string; result: CompileResult },
  entry?: string,
): string {
  const dir = path.join(built.dir, "swift");
  const modules = path.join(dir, "modules");
  fs.mkdirSync(modules, { recursive: true });
  const write = (name: string, text: string) => {
    fs.writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };
  const files = built.result.files;
  const swift = write("Weather.swift", files.get("ios-extensions/Weather/widgets/Weather.swift")!);
  const header = write("Weather.h", files.get("ios-extensions/Weather/widgets/Weather.h")!);
  const flags = ["-parse-as-library", "-warnings-as-errors", "-swift-version", "5"];

  const library = run(m, [
    "-emit-module",
    ...flags,
    "-module-name",
    "LucentExtensions",
    "-I",
    m.modules,
    "-import-objc-header",
    header,
    // A precompiled bridging header is Darwin's; elsewhere the header is read as it is.
    "-disable-bridging-pch",
    "-emit-module-path",
    path.join(modules, "LucentExtensions.swiftmodule"),
    swift,
  ]);
  if (library.status !== 0 || entry === undefined)
    return library.status === 0 ? "" : library.stderr;

  const target = run(m, [
    "-typecheck",
    ...flags,
    "-I",
    m.modules,
    "-I",
    modules,
    write("LucentWidget.swift", entry),
  ]);
  return target.status === 0 ? "" : target.stderr;
}
