import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runLucent } from "./run-to-exit.ts";

const require = createRequire(import.meta.url);

interface Transformer {
  transform(a: { filename: string; src: string; options: { projectRoot: string } }): string;
  getCacheKey(options?: { projectRoot: string }): string;
}

/** A project whose upstream transformer returns the source it is given. */
function metroProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
  const upstream = path.join(root, "upstream.cjs");
  fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
  process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
  return root;
}

const transformer = () => require("../metro/transformer.cjs") as Transformer;

/** The file a transformed module requires, resolved from the module's directory. */
function requiredBy(t: Transformer, filename: string, projectRoot: string): string {
  const out = t.transform({ filename, src: "", options: { projectRoot } });
  const spec = /require\(("[^"]+")\)/.exec(out)?.[1];
  expect(spec, out).toBeDefined();
  return path.resolve(path.dirname(filename), JSON.parse(spec as string) as string);
}

describe("Metro transformer", () => {
  it("bundles a Lucent module as a require of its proxy, which Metro watches", () => {
    const root = metroProject();
    const pkg = path.join(root, "node_modules/lucent-a");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-a", lucent: { sources: "src" } }),
    );
    fs.mkdirSync(path.join(root, ".lucent/native/js/lucent-a"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".lucent/native/js/lucent-a/storage.js"),
      "// the proxy of lucent-a/storage\n",
    );
    fs.writeFileSync(path.join(root, ".lucent/native/js/storage.js"), "// the app's storage\n");
    const t = transformer();

    expect(requiredBy(t, path.join(pkg, "src/storage.lucent.ts"), root)).toBe(
      path.join(root, ".lucent/native/js/lucent-a/storage.js"),
    );

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    expect(requiredBy(t, path.join(root, "src/storage.lucent.ts"), root)).toBe(
      path.join(root, ".lucent/native/js/storage.js"),
    );
  });

  it("refuses to bundle a module that has not been compiled", () => {
    const root = metroProject();
    const t = transformer();

    expect(() =>
      t.transform({
        filename: path.join(root, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toThrow(/storage\.lucent\.ts has not been compiled\. Run `lucent build`/);
  });

  it("fails a module whose last build has problems with their code frames, for the RedBox", () => {
    const root = metroProject();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
    const file = path.join(root, "bad.lucent.ts");
    const source = 'export function f(): number {\n  const n: number = "s";\n  return n;\n}\n';
    fs.writeFileSync(file, source);

    const r = runLucent(["build", "--platforms", "host", "--root", root], {
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(r.status).toBe(1);
    const t = transformer();
    const transform = (src: string) =>
      t.transform({ filename: "bad.lucent.ts", src, options: { projectRoot: root } });

    let message = "";
    try {
      transform(source);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/bad\.lucent\.ts does not compile/);
    expect(message).toMatch(/LUCENT9001/);
    expect(message).toMatch(/2 │ {3}const n: number = "s";/);

    // Fixed and built: the module bundles as its proxy again.
    fs.writeFileSync(file, source.replace('"s"', "1"));
    expect(
      runLucent(["build", "--platforms", "host", "--root", root], { env: process.env }).status,
    ).toBe(0);
    expect(transform(source.replace('"s"', "1"))).toMatch(/require\(/);
  });

  it("keys the cache on the native package of the projectRoot Metro passes", () => {
    const root = metroProject();
    expect(path.resolve(root)).not.toBe(process.cwd());
    fs.mkdirSync(path.join(root, ".lucent/native"), { recursive: true });
    const manifest = (m: object) =>
      fs.writeFileSync(path.join(root, ".lucent/native/manifest.json"), JSON.stringify(m));
    const t = transformer();
    const key = () => t.getCacheKey({ projectRoot: root });

    manifest({ inputs: "a", modules: ["storage"] });
    const before = key();

    // A build that changes no module name changes no module's output.
    manifest({ inputs: "b", modules: ["storage"] });
    expect(key()).toBe(before);

    manifest({ inputs: "b", modules: ["storage", "haptics"] });
    expect(key()).not.toBe(before);
  });

  it("names a module in a package's folder whose package.json only sets the module type as the package's", () => {
    const root = metroProject();
    const pkg = path.join(root, "node_modules/lucent-a");
    fs.mkdirSync(path.join(pkg, "src/geo"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-a", lucent: { sources: "src" } }),
    );
    fs.writeFileSync(path.join(pkg, "src/geo/package.json"), JSON.stringify({ type: "module" }));
    fs.mkdirSync(path.join(root, ".lucent/native/js/lucent-a/geo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".lucent/native/js/lucent-a/geo/distance.js"),
      "// the proxy of lucent-a/geo/distance\n",
    );

    expect(requiredBy(transformer(), path.join(pkg, "src/geo/distance.lucent.ts"), root)).toBe(
      path.join(root, ".lucent/native/js/lucent-a/geo/distance.js"),
    );
  });

  it("says a package's module is compiled only when the app depends on the package", () => {
    const root = metroProject();
    const pkg = path.join(root, "packages/lucent-far");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-far", lucent: { sources: "src" } }),
    );
    const t = transformer();

    expect(() =>
      t.transform({
        filename: path.join(pkg, "src/far.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toThrow(/has not been compiled.*compiles lucent-far only when the app depends on it/);
  });
});

describe("Metro transformer with LUCENT_OUT", () => {
  it("bundles the proxies of the native package lucent build --out wrote", () => {
    const root = metroProject();

    // The app's own package, and another build of it elsewhere.
    fs.mkdirSync(path.join(root, ".lucent/native/js"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".lucent/native/js/storage.js"),
      'const id = require("./_lucent/identity.js"); // the app\'s\n',
    );
    const out = path.join(root, "host/native");
    fs.mkdirSync(path.join(out, "js"), { recursive: true });
    fs.writeFileSync(
      path.join(out, "js/storage.js"),
      'const id = require("./_lucent/identity.js"); // --out\'s\n',
    );

    const t = transformer();
    const proxy = () => requiredBy(t, path.join(root, "src/storage.lucent.ts"), root);

    try {
      // Relative to the project, as lucent build --out resolves it.
      process.env.LUCENT_OUT = "host/native";

      // The proxy, and so what it requires (the loader, the build identity), come from that package.
      expect(proxy()).toBe(path.join(out, "js/storage.js"));
    } finally {
      delete process.env.LUCENT_OUT;
    }

    expect(proxy()).toBe(path.join(root, ".lucent/native/js/storage.js"));
  });

  it("keys the cache on that package's module names", () => {
    const root = metroProject();
    const out = path.join(root, "host");
    fs.mkdirSync(out, { recursive: true });
    const t = transformer();

    try {
      process.env.LUCENT_OUT = out;
      fs.writeFileSync(path.join(out, "manifest.json"), '{"modules":["a"]}');
      const before = t.getCacheKey({ projectRoot: root });
      fs.writeFileSync(path.join(out, "manifest.json"), '{"modules":["a","b"]}');

      expect(t.getCacheKey({ projectRoot: root })).not.toBe(before);
    } finally {
      delete process.env.LUCENT_OUT;
    }
  });
});

describe("Metro resolver", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
  const upstream = path.join(root, "upstream.cjs");
  fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");

  // Metro reads extraNodeModules by indexing it with a package's name (metro-resolver's resolve.js).
  const resolverOf = (extraNodeModules: object) => {
    const { withLucent } = require("../metro/index.cjs") as {
      withLucent(
        config: object,
        options: { watch: boolean },
      ): { resolver: { extraNodeModules: Record<string, string | undefined> } };
    };

    return withLucent(
      {
        projectRoot: root,
        transformer: { babelTransformerPath: upstream },
        resolver: { extraNodeModules },
      },
      { watch: false },
    ).resolver.extraNodeModules;
  };

  it("resolves lucent:views/<module> to the forwarders lucent build writes", () => {
    const modules = resolverOf({ shared: path.join(root, "shared") });

    expect(modules["lucent:views"]).toBe(path.join(root, ".lucent/native/js/_lucent/components"));
    expect(modules.shared).toBe(path.join(root, "shared"));

    try {
      process.env.LUCENT_OUT = "out";

      expect(resolverOf({})["lucent:views"]).toBe(path.join(root, "out/js/_lucent/components"));
    } finally {
      delete process.env.LUCENT_OUT;
    }
  });

  it("keeps resolving the names an app's extraNodeModules computes", () => {
    // A monorepo's fallback: every name maps to the app's node_modules.
    const modules = resolverOf(
      new Proxy({}, { get: (_, name) => path.join(root, "node_modules", String(name)) }),
    );

    expect(modules.react).toBe(path.join(root, "node_modules/react"));
    expect(modules["lucent:views"]).toBe(path.join(root, ".lucent/native/js/_lucent/components"));
  });
});
