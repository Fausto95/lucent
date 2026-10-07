/**
 * JS dev mode (metro/js-dev.cjs): Metro bundles each *.lucent.ts module as
 * its JavaScript, so edits refresh without a native rebuild. These run what
 * the transformer gives Metro the way a bundle runs it: CommonJS, with
 * react-native's Platform as the app's.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);

interface Transformer {
  transform(a: {
    filename: string;
    src: string;
    options: { projectRoot: string; dev?: boolean };
  }): string;
  getCacheKey(options?: { projectRoot: string }): string;
}

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-js-dev-")));
  const upstream = path.join(root, "upstream.cjs");
  fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
  process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

const transformer = () => {
  delete require.cache[require.resolve("../metro/transformer.cjs")];
  return require("../metro/transformer.cjs") as Transformer;
};

/** Loads `file` as the bundle would, every *.lucent.ts through the transformer, on `os`. */
function load(
  root: string,
  file: string,
  os_: "ios" | "android" = "android",
): Record<string, unknown> {
  const t = transformer();
  const cache = new Map<string, { exports: unknown }>();
  const run = (abs: string): unknown => {
    if (cache.has(abs)) return cache.get(abs)!.exports;
    const m = { exports: {} as unknown };
    cache.set(abs, m);
    const src = /\.lucent\.tsx?$/.test(abs)
      ? t.transform({
          filename: abs,
          src: fs.readFileSync(abs, "utf8"),
          options: { projectRoot: root },
        })
      : fs.readFileSync(abs, "utf8");
    const req = (spec: string) => {
      if (spec === "react-native") return { Platform: { OS: os_ } };
      return run(require.resolve(path.resolve(path.dirname(abs), spec)));
    };
    vm.runInThisContext(`(function (module, exports, require) {${src}\n})`, { filename: abs })(
      m,
      m.exports,
      req,
    );
    return m.exports;
  };
  return run(path.join(root, file)) as Record<string, unknown>;
}

afterEach(() => {
  delete process.env.LUCENT_JS_DEV;
});

describe("JS dev mode", () => {
  it("bundles a module as its JavaScript, with lucent:core's implementation, no build needed", async () => {
    process.env.LUCENT_JS_DEV = "1";
    const root = project({
      "src/greet.lucent.ts": `import { utf8Encode, delay } from "lucent:core";
export function greet(name: string): string {
  return \`hello \${name}\`.toUpperCase();
}
export async function size(s: string): Promise<number> {
  await delay(1);
  return utf8Encode(s).length;
}
`,
    });
    const m = load(root, "src/greet.lucent.ts") as {
      greet(n: string): string;
      size(s: string): Promise<number>;
    };
    expect(m.greet("ada")).toBe("HELLO ADA");
    expect(await m.size("é")).toBe(2);
  });

  it("branches on the running platform, and fails clearly where platform code calls the SDK", async () => {
    process.env.LUCENT_JS_DEV = "1";
    const root = project({
      "src/device.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { Build } from "lucent:android/android.os";
import { UIDevice } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export function name(): string {
  return PLATFORM === "android" ? "droid" : "phone";
}
export function model(): string {
  if (PLATFORM === "android") return Build.MODEL ?? "";
  return UIDevice.current.model;
}
export function later(): Promise<number> {
  return main(() => 2);
}
`,
    });
    const android = load(root, "src/device.lucent.ts", "android") as Record<string, () => unknown>;
    expect(android.name!()).toBe("droid");
    expect(await android.later!()).toBe(2);
    expect(() => android.model!()).toThrow(
      /Build \(lucent:android\/android\.os\) is native code, which JS dev mode can't run/,
    );
    try {
      android.model!();
    } catch (e) {
      expect((e as { code?: string }).code).toBe("LUCENT_JS_DEV_NATIVE");
    }
    const ios = load(root, "src/device.lucent.ts", "ios") as Record<string, () => unknown>;
    expect(ios.name!()).toBe("phone");
    expect(() => ios.model!()).toThrow(/UIDevice \(lucent:ios\/UIKit\)/);
  });

  it("runs the platform's file of a split module", () => {
    process.env.LUCENT_JS_DEV = "1";
    const root = project({
      "src/os.lucent.ts": "export declare function os(): string;\n",
      "src/os.ios.lucent.ts": 'export function os(): string { return "iOS"; }\n',
      "src/os.android.lucent.ts": 'export function os(): string { return "Android"; }\n',
    });
    expect((load(root, "src/os.lucent.ts", "ios") as { os(): string }).os()).toBe("iOS");
    expect((load(root, "src/os.lucent.ts", "android") as { os(): string }).os()).toBe("Android");
  });

  it("keeps components native, refuses a release bundle, and keys Metro's cache on the mode", () => {
    const root = project({
      "src/a.lucent.ts": "export function a(): number { return 1; }\n",
      "src/card.lucent.tsx": "export {};\n",
    });
    const t = transformer();
    const off = t.getCacheKey({ projectRoot: root });
    process.env.LUCENT_JS_DEV = "1";
    expect(t.getCacheKey({ projectRoot: root })).not.toBe(off);

    expect(() =>
      t.transform({
        filename: path.join(root, "src/a.lucent.ts"),
        src: "export function a(): number { return 1; }\n",
        options: { projectRoot: root, dev: false },
      }),
    ).toThrow(/development only: bundle releases without it/);
    // A component is a native view: its proxy, which needs a build.
    expect(() =>
      t.transform({
        filename: path.join(root, "src/card.lucent.tsx"),
        src: "export {};\n",
        options: { projectRoot: root },
      }),
    ).toThrow(/card\.lucent\.tsx has not been compiled/);
  });

  it("is off unless asked for: withLucent's js option or LUCENT_JS=1", () => {
    const { withLucent } = require("../metro/index.cjs") as {
      withLucent(c: object, o?: { watch?: boolean; js?: boolean }): object;
    };
    const config = {
      transformer: { babelTransformerPath: process.env.LUCENT_UPSTREAM_TRANSFORMER },
    };
    withLucent(config, { watch: false });
    expect(process.env.LUCENT_JS_DEV).toBe("0");
    withLucent(config, { watch: false, js: true });
    expect(process.env.LUCENT_JS_DEV).toBe("1");
    process.env.LUCENT_JS = "1";
    try {
      withLucent(config, { watch: false });
      expect(process.env.LUCENT_JS_DEV).toBe("1");
    } finally {
      delete process.env.LUCENT_JS;
    }
  });
});
