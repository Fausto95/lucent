import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);

describe("Metro transformer", () => {
  it("swaps a package's Lucent module for its proxy, named <package>/<module>", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
    const upstream = path.join(root, "upstream.cjs");
    fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
    process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
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
    fs.mkdirSync(path.join(root, ".lucent/native/js"), { recursive: true });
    fs.writeFileSync(path.join(root, ".lucent/native/js/storage.js"), "// the app's storage\n");
    const t = require("../metro/transformer.cjs") as {
      transform(a: { filename: string; src: string; options: { projectRoot: string } }): string;
    };
    expect(
      t.transform({
        filename: path.join(pkg, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toBe("// the proxy of lucent-a/storage\n");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    expect(
      t.transform({
        filename: path.join(root, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toBe("// the app's storage\n");
  });

  it("points the proxy's loader require at the generated loader, from where the module is", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
    const upstream = path.join(root, "upstream.cjs");
    fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
    process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;
    const pkg = path.join(root, "node_modules/lucent-a");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "lucent-a", lucent: { sources: "src" } }),
    );
    fs.mkdirSync(path.join(root, ".lucent/native/js/lucent-a"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".lucent/native/js/lucent-a/storage.js"),
      'const r = require("../_lucent/runtime.js");\n',
    );
    fs.writeFileSync(
      path.join(root, ".lucent/native/js/app.js"),
      'const r = require("./_lucent/runtime.js");\n',
    );
    const t = require("../metro/transformer.cjs") as {
      transform(a: { filename: string; src: string; options: { projectRoot: string } }): string;
    };
    expect(
      t.transform({
        filename: path.join(root, "src/deep/app.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toBe('const r = require("../../.lucent/native/js/_lucent/runtime.js");\n');
    expect(
      t.transform({
        filename: path.join(pkg, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      }),
    ).toBe('const r = require("../../../.lucent/native/js/_lucent/runtime.js");\n');
  });
});

describe("Metro transformer with LUCENT_OUT", () => {
  it("bundles the proxies of the native package lucent build --out wrote", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
    const upstream = path.join(root, "upstream.cjs");
    fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
    process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;

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

    const t = require("../metro/transformer.cjs") as {
      transform(a: { filename: string; src: string; options: { projectRoot: string } }): string;
    };
    const transform = () =>
      t.transform({
        filename: path.join(root, "src/storage.lucent.ts"),
        src: "",
        options: { projectRoot: root },
      });

    try {
      // Relative to the project, as lucent build --out resolves it.
      process.env.LUCENT_OUT = "host/native";

      // The proxy and what it requires (the loader, the build identity) come from that package.
      expect(transform()).toBe(
        'const id = require("../host/native/js/_lucent/identity.js"); // --out\'s\n',
      );
    } finally {
      delete process.env.LUCENT_OUT;
    }

    expect(transform()).toBe(
      'const id = require("../.lucent/native/js/_lucent/identity.js"); // the app\'s\n',
    );
  });

  it("keys the cache on that package's manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-"));
    const upstream = path.join(root, "upstream.cjs");
    fs.writeFileSync(upstream, "module.exports = { transform: (a) => a.src };\n");
    process.env.LUCENT_UPSTREAM_TRANSFORMER = upstream;

    const out = path.join(root, "host");
    fs.mkdirSync(out, { recursive: true });
    const t = require("../metro/transformer.cjs") as { getCacheKey(): string };

    try {
      process.env.LUCENT_OUT = out;
      fs.writeFileSync(path.join(out, "manifest.json"), '{"a":1}');
      const before = t.getCacheKey();
      fs.writeFileSync(path.join(out, "manifest.json"), '{"a":2}');

      expect(t.getCacheKey()).not.toBe(before);
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
      { projectRoot: root, transformer: { babelTransformerPath: upstream }, resolver: { extraNodeModules } },
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
