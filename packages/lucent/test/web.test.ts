/**
 * The web target (metro/web.cjs, decision 0133): for the `web` platform Metro bundles
 * each *.lucent.ts module as its JavaScript, releases too, with PLATFORM
 * "web"; withLucent's resolver puts a module's web twin in its place; and
 * what the web can't run fails the module's transform, naming the code.
 * These run what the transformer gives Metro the way a bundle runs it.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);

interface Transformer {
  transform(a: {
    filename: string;
    src: string;
    options: { projectRoot: string; dev?: boolean; platform?: string };
  }): string;
}

type Resolution = { type: "sourceFile"; filePath: string } | { type: "empty" };
type Resolve = (context: object, moduleName: string, platform: string | null) => Resolution;

function project(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-web-")));
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

/** withLucent's resolver over Metro's (here: a relative path, with `.ts` tried). */
function resolver(): Resolve {
  const { withLucent } = require("../metro/index.cjs") as {
    withLucent(c: object, o?: { watch?: boolean }): { resolver: { resolveRequest: Resolve } };
  };
  const config = withLucent(
    { transformer: { babelTransformerPath: process.env.LUCENT_UPSTREAM_TRANSFORMER } },
    { watch: false },
  );
  return config.resolver.resolveRequest;
}

/** Metro's own resolution, as context.resolveRequest gives it a custom resolver. */
const metro = (context: { origin: string }, name: string): Resolution => {
  const base = path.resolve(path.dirname(context.origin), name);
  for (const f of [base, `${base}.ts`, `${base}.js`])
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return { type: "sourceFile", filePath: f };
  return { type: "empty" };
};

/** Loads `file` as a web bundle would: resolved by withLucent's resolver, each *.lucent.ts transformed. */
function load(root: string, file: string, dev = false): Record<string, unknown> {
  const t = transformer();
  const resolve = resolver();
  const cache = new Map<string, { exports: unknown }>();
  const run = (abs: string): unknown => {
    if (cache.has(abs)) return cache.get(abs)!.exports;
    const m = { exports: {} as unknown };
    cache.set(abs, m);
    const src = /\.lucent\.tsx?$/.test(abs)
      ? t.transform({
          filename: abs,
          src: fs.readFileSync(abs, "utf8"),
          options: { projectRoot: root, dev, platform: "web" },
        })
      : fs.readFileSync(abs, "utf8");
    const req = (spec: string) => {
      if (spec === "react-native") return { Platform: { OS: "web" } };
      if (!spec.startsWith(".")) return require(spec);
      const found = resolve({ origin: abs, resolveRequest: metro }, spec, "web");
      if (found.type !== "sourceFile") throw new Error(`can't resolve ${spec}`);
      return run(found.filePath);
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

/** The transform of `file` for the web: what it throws, or undefined. */
function refusal(root: string, file: string): string | undefined {
  try {
    transformer().transform({
      filename: path.join(root, file),
      src: fs.readFileSync(path.join(root, file), "utf8"),
      options: { projectRoot: root, platform: "web" },
    });
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

describe("the web target", () => {
  it("bundles a shared module as its JavaScript, in a release bundle too, on PLATFORM web", async () => {
    const root = project({
      "src/app.ts": 'module.exports = require("./greet.lucent");\n',
      "src/greet.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { delay, utf8Encode } from "lucent:core";
import { main } from "lucent:thread";
export function greet(name: string): string {
  return \`hello \${name} on \${PLATFORM}\`;
}
export async function size(s: string): Promise<number> {
  await delay(1);
  return main(() => utf8Encode(s).length);
}
`,
    });
    const m = load(root, "src/app.ts") as {
      greet(n: string): string;
      size(s: string): Promise<number>;
    };
    expect(m.greet("ada")).toBe("hello ada on web");
    expect(await m.size("é")).toBe(2);
  });

  it("resolves a module to its web twin, plain TypeScript in its place", () => {
    const root = project({
      "src/app.ts": 'module.exports = require("./store.lucent");\n',
      "src/store.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { NSUserDefaults } from "lucent:ios/Foundation";
const values = new Map<string, string>();
export function save(key: string, value: string): void {
  if (PLATFORM === "ios") NSUserDefaults.standardUserDefaults.setObject_forKey(value, key);
  else values.set(key, value);
}
`,
      "src/store.web.lucent.ts": `import { utf8Encode } from "lucent:core";
const saved: string[] = [];
export function save(key: string, value: string): void {
  saved.push(\`\${key}=\${value} (\${utf8Encode(value).length} bytes)\`);
}
export const all = (): string[] => saved;
`,
    });
    const m = load(root, "src/app.ts") as { save(k: string, v: string): void; all(): string[] };
    m.save("name", "ada");
    expect(m.all()).toEqual(["name=ada (3 bytes)"]);
    // Elsewhere, the module itself.
    expect(
      resolver()(
        { origin: path.join(root, "src/app.ts"), resolveRequest: metro },
        "./store.lucent",
        "ios",
      ),
    ).toEqual({ type: "sourceFile", filePath: path.join(root, "src/store.lucent.ts") });
  });

  it("fails a module's transform where it needs a twin, naming its platform code", () => {
    const root = project({
      "src/device.lucent.ts": `import { PLATFORM } from "lucent:platform";
import type { UIDevice as Device } from "lucent:ios/UIKit";
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";
export function model(): string {
  return PLATFORM === "ios" ? UIDevice.current.model : (Build.MODEL ?? "");
}
export type { Device };
`,
      "src/os.lucent.ts": "export declare function os(): string;\n",
      "src/os.ios.lucent.ts": 'export function os(): string { return "iOS"; }\n',
      "src/os.android.lucent.ts": 'export function os(): string { return "Android"; }\n',
      "src/kv.web.lucent.ts":
        'import { Build } from "lucent:android/android.os";\nexport const model = Build.MODEL;\n',
      "src/card.lucent.tsx": "export {};\n",
    });
    expect(refusal(root, "src/device.lucent.ts")).toBe(
      "Lucent: device.lucent.ts uses platform code, which the web can't run: line 3 imports lucent:ios/UIKit (and lucent:android/android.os). Add device.web.lucent.ts, TypeScript that exports what device.lucent.ts does, for the web.",
    );
    expect(refusal(root, "src/os.lucent.ts")).toBe(
      "Lucent: os.lucent.ts is a platform module (os.ios.lucent.ts, os.android.lucent.ts), which the web can't run: add os.web.lucent.ts, TypeScript that exports what it declares, for the web.",
    );
    expect(refusal(root, "src/kv.web.lucent.ts")).toBe(
      "Lucent: kv.web.lucent.ts is a web twin, which runs on the web, but line 1 imports lucent:android/android.os. Of Lucent's modules the web has lucent:core, lucent:thread, lucent:platform.",
    );
    expect(refusal(root, "src/card.lucent.tsx")).toMatch(
      /^Lucent: card\.lucent\.tsx is a component module, whose views are native: the web has none/,
    );
    expect(() =>
      resolver()(
        { origin: path.join(root, "src/App.tsx"), resolveRequest: metro },
        "lucent:views/card",
        "web",
      ),
    ).toThrow(/lucent:views\/card is a component, whose views are native: the web has none/);
  });

  it("keeps the app's own resolver, which it runs first", () => {
    const { withLucent } = require("../metro/index.cjs") as {
      withLucent(c: object, o?: { watch?: boolean }): { resolver: { resolveRequest: Resolve } };
    };
    const root = project({ "src/a.lucent.ts": "", "src/a.web.lucent.ts": "" });
    const seen: string[] = [];
    const { resolveRequest } = withLucent(
      {
        transformer: { babelTransformerPath: process.env.LUCENT_UPSTREAM_TRANSFORMER },
        resolver: {
          resolveRequest: (context: { origin: string }, name: string, platform: string) => {
            seen.push(`${name} ${platform}`);
            return metro(context, name);
          },
        },
      },
      { watch: false },
    ).resolver;
    const origin = path.join(root, "src/app.ts");
    expect(resolveRequest({ origin, resolveRequest: metro }, "./a.lucent", "web")).toEqual({
      type: "sourceFile",
      filePath: path.join(root, "src/a.web.lucent.ts"),
    });
    expect(seen).toEqual(["./a.lucent web"]);
  });
});
