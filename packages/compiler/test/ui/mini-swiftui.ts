/**
 * SwiftUI bodies on hosts without Xcode: a miniature SwiftUI, UIKit and
 * WidgetKit (mini-swiftui/*.swift), built with the host's swiftc, stand in
 * for the SDK's. The miniature SwiftUI's symbol graph is its schema, as Xcode's
 * SwiftUI interface is the real one's (lucent:swiftui is generated from
 * either the same way), in a schema set beside a UIKit schema of the
 * classes a body's types name. A component compiled against the set has
 * its Swift generated, which then type-checks against the miniature
 * modules. What it checks is the writer's: the miniature declares what
 * tests use, in SwiftUI's shapes, not SwiftUI.
 *
 * Needs swiftc and swift-symbolgraph-extract (a Swift toolchain, or
 * Xcode's); without them, `miniSwiftUI()` is undefined.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSourceSchema, SCHEMA_SET_FORMAT } from "@lucent-lang/bindgen";
import { extensionGraphs, withExtensions } from "../../../bindgen/src/ios.ts";
import { compile, type CompileResult } from "../../src/index.ts";
import { typed } from "../schema-set.ts";

const sources = path.join(import.meta.dirname, "mini-swiftui");

export interface MiniSwiftUI {
  /** The schema set: SwiftUI written as source, and UIKit's classes. */
  readonly set: string;
  /** Where the miniature modules are built, for `-I`. */
  readonly modules: string;
  /** The Swift compiler, and the arguments before its own. */
  readonly swiftc: readonly [string, ...string[]];
}

/** A Swift tool: on PATH, beside the swiftc on PATH, or Xcode's. */
function tool(name: string): readonly [string, ...string[]] | undefined {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
  if (found) return [found];

  const swiftc = spawnSync("sh", ["-c", 'readlink -f "$(command -v swiftc)"'], {
    encoding: "utf8",
  }).stdout.trim();
  const beside = swiftc && path.join(path.dirname(swiftc), name);
  if (beside && fs.existsSync(beside)) return [beside];

  return process.platform === "darwin" && spawnSync("xcrun", ["--find", name]).status === 0
    ? ["xcrun", name]
    : undefined;
}

const run = (cmd: readonly [string, ...string[]], args: string[]) =>
  spawnSync(cmd[0], [...cmd.slice(1), ...args], { encoding: "utf8", maxBuffer: 64 << 20 });

let built: MiniSwiftUI | null | undefined = null;

/** The miniature SwiftUI, built once per run and cached by its sources; undefined without Swift. */
export function miniSwiftUI(): MiniSwiftUI | undefined {
  if (built !== null) return built;

  built = undefined;

  const swiftc = tool("swiftc");
  const extract = tool("swift-symbolgraph-extract");
  if (!swiftc || !extract) return undefined;

  const info = run(swiftc, ["-print-target-info"]);
  if (info.status !== 0) return undefined;

  const triple = (JSON.parse(info.stdout) as { target: { triple: string } }).target.triple;
  const files = ["UIKit.swift", "SwiftUI.swift", "WidgetKit.swift"].map((f) =>
    path.join(sources, f),
  );
  const key = crypto
    .createHash("sha256")
    .update(info.stdout)
    .update(files.map((f) => fs.readFileSync(f, "utf8")).join("\n"))
    .digest("hex")
    .slice(0, 12);
  const dir = path.join(os.tmpdir(), `lucent-mini-swiftui-${key}`);
  const modules = path.join(dir, "modules");
  const set = path.join(dir, "set");

  if (!fs.existsSync(path.join(set, "ios", "SwiftUI.source.json"))) {
    const work = fs.mkdtempSync(`${dir}.`);
    const out = path.join(work, "modules");
    const graphs = path.join(work, "graphs");
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(graphs);

    for (const [module, file] of [
      ["UIKit", files[0]!],
      ["SwiftUI", files[1]!],
      // What a widget's Swift uses besides (decision 0124); no Lucent code imports it.
      ["WidgetKit", files[2]!],
    ] as const) {
      const r = run(swiftc, [
        "-emit-module",
        "-parse-as-library",
        "-module-name",
        module,
        "-I",
        out,
        "-emit-module-path",
        path.join(out, `${module}.swiftmodule`),
        file,
      ]);
      if (r.status !== 0) throw new Error(`the miniature ${module} does not build:\n${r.stderr}`);
    }

    const g = run(extract, [
      "-module-name",
      "SwiftUI",
      "-target",
      triple,
      "-I",
      out,
      "-output-dir",
      graphs,
      "-minimum-access-level",
      "public",
    ]);
    if (g.status !== 0) throw new Error(`swift-symbolgraph-extract SwiftUI:\n${g.stderr}`);

    const read = (file: string) =>
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
    const graph = withExtensions(
      read(path.join(graphs, "SwiftUI.symbols.json")),
      extensionGraphs(graphs, "SwiftUI", read),
    );
    const entry = (module: string, kind: "source" | "schema", schema: unknown) =>
      JSON.stringify({
        format: SCHEMA_SET_FORMAT,
        platform: "ios",
        module,
        kind,
        artifacts: [`sdk:iphonesimulator26.0#${module}`],
        schema,
      });
    const ios = path.join(work, "set", "ios");
    fs.mkdirSync(ios, { recursive: true });
    fs.writeFileSync(
      path.join(ios, "SwiftUI.source.json"),
      entry("SwiftUI", "source", buildSourceSchema("SwiftUI", [graph])),
    );
    // The classes lucent:swiftui's types name (a body's views are UIViews to JSX).
    fs.writeFileSync(
      path.join(ios, "UIKit.json"),
      entry(
        "UIKit",
        "schema",
        typed({
          module: "UIKit",
          header: "UIKit/UIKit.h",
          types: ["UIView", "UIViewController"].map((name) => ({
            kind: "class",
            name,
            native: name,
            mainActor: true,
            constructors: [{ params: [], selector: "init" }],
          })),
        }),
      ),
    );
    fs.rmSync(graphs, { recursive: true, force: true });

    // Published by rename: another process may have built it meanwhile.
    try {
      fs.renameSync(work, dir);
    } catch {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  built = { set, modules, swiftc };
  return built;
}

/** `files` in a package `@acme/app`, compiled for iOS against the miniature SwiftUI. */
export function buildSwiftUI(
  mini: MiniSwiftUI,
  files: Record<string, string>,
): { dir: string; result: CompileResult } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-mini-swiftui-app-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  const result = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      sdk: {
        schemas: mini.set,
        cacheDir: path.join(dir, "cache"),
        // No SDK, wherever the tests run: the set is all there is.
        ios: { xcrun: path.join(dir, "no-xcrun") },
      },
    },
  );

  return { dir, result };
}

/**
 * What swiftc says of the views' generated Swift (ios/views/; the exports'
 * Swift API takes the entries' C header, which native-exports-swift.test.ts
 * checks), type-checked against the miniature modules: "" when it compiles.
 */
export function miniSwiftErrors(
  mini: MiniSwiftUI,
  built: { dir: string; result: CompileResult },
): string {
  const out = path.join(built.dir, "swift");
  const swift = [...built.result.files]
    .filter(([f]) => f.startsWith("ios/views/") && f.endsWith(".swift"))
    .map(([f, text]) => {
      const file = path.join(out, f);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    });
  const r = run(mini.swiftc, [
    "-typecheck",
    "-parse-as-library",
    "-warnings-as-errors",
    "-swift-version",
    "5",
    "-I",
    mini.modules,
    ...swift,
  ]);

  return r.status === 0 ? "" : r.stderr;
}
