import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

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

    expect(
      t.transform({
        filename: path.join(pkg, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toBe('module.exports = require("../../../.lucent/native/js/lucent-a/storage.js");\n');

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    expect(
      t.transform({
        filename: path.join(root, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toBe('module.exports = require("../.lucent/native/js/storage.js");\n');
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
    const transform = () =>
      t.transform({
        filename: path.join(root, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      });

    try {
      // Relative to the project, as lucent build --out resolves it.
      process.env.LUCENT_OUT = "host/native";

      // The proxy, and so what it requires (the loader, the build identity), come from that package.
      expect(transform()).toBe('module.exports = require("../host/native/js/storage.js");\n');
    } finally {
      delete process.env.LUCENT_OUT;
    }

    expect(transform()).toBe('module.exports = require("../.lucent/native/js/storage.js");\n');
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
