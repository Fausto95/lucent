/**
 * The Metro integration against a running Metro: what it serves after a
 * build rewrites a proxy while it runs, the *.lucent.ts module unchanged.
 */
import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const repo = path.resolve(import.meta.dirname, "../../..");
const modules = path.join(repo, "node_modules");
const hasMetro = fs.existsSync(path.join(modules, "metro/package.json"));
const require = createRequire(path.join(modules, "metro/package.json"));

interface Metro {
  loadConfig(argv: { config: string; port: number }, defaults: object): Promise<object>;
  runServer(config: object, options: { host: string }): Promise<{ httpServer: Server }>;
}

const running: Server[] = [];

/** The markers of the proxies a bundle holds. */
const markers = (bundle: string) =>
  [...bundle.matchAll(/exports\.marker = "([^"]*)"/g)].map((m) => m[1]);

afterEach(async () => {
  for (const server of running.splice(0))
    await new Promise((resolve) => server.close(() => resolve(undefined)));
});

/** A project whose index.js imports src/a.lucent.ts, served by Metro on a free port. */
async function serve() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-metro-server-"));
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app", "private": true }\n');
  fs.writeFileSync(path.join(root, "index.js"), 'globalThis.a = require("./src/a.lucent");\n');
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src/a.lucent.ts"),
    "export function one(): number { return 1; }\n",
  );

  const json = JSON.stringify;
  fs.writeFileSync(
    path.join(root, "metro.config.js"),
    `const { FileStore } = require(${json(require.resolve("metro-cache"))});
const { withLucent } = require(${json(path.join(repo, "packages/lucent/metro/index.cjs"))});
module.exports = withLucent(
  {
    projectRoot: __dirname,
    watchFolders: [${json(path.join(modules, "metro-runtime"))}],
    maxWorkers: 1,
    reporter: { update: () => {} },
    cacheStores: [new FileStore({ root: __dirname + "/metro-cache" })],
    resolver: { useWatchman: false, nodeModulesPaths: [${json(modules)}] },
    transformer: { babelTransformerPath: ${json(require.resolve("metro-babel-transformer"))} },
  },
  { watch: false },
);
`,
  );

  const metro = require("metro") as Metro;
  const loaded = await metro.loadConfig(
    { config: path.join(root, "metro.config.js"), port: 0 },
    {},
  );
  const { httpServer } = await metro.runServer(loaded, { host: "127.0.0.1" });
  running.push(httpServer);
  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/index.bundle?platform=ios&dev=true&minify=false`;

  /** Writes a.lucent.ts's proxy as a build publishes it: a temporary file renamed into place. */
  const build = (marker: string) => {
    const proxy = path.join(root, ".lucent/native/js/a.js");
    fs.mkdirSync(path.dirname(proxy), { recursive: true });
    fs.writeFileSync(`${proxy}.tmp`, `exports.marker = ${JSON.stringify(marker)};\n`);
    fs.renameSync(`${proxy}.tmp`, proxy);
    fs.writeFileSync(
      path.join(root, ".lucent/native/manifest.json"),
      JSON.stringify({ inputs: marker, modules: ["a"] }),
    );
  };

  const fetchBundle = async () => {
    const r = await fetch(url);
    return { status: r.status, text: await r.text() };
  };

  /** The bundle once it holds `marker`, or the last one after 15 s. */
  const bundleWith = async (marker: string) => {
    const since = Date.now();
    for (;;) {
      const bundle = await fetchBundle();
      if (bundle.text.includes(marker) || Date.now() - since > 15_000) return bundle;
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  return { build, fetchBundle, bundleWith };
}

describe.skipIf(!hasMetro)("a running Metro", () => {
  it("serves the proxy a build rewrites while Metro runs, the module unchanged", async () => {
    const metro = await serve();
    metro.build("P1");
    expect(markers((await metro.bundleWith("P1")).text)).toEqual(["P1"]);

    metro.build("P2");
    const bundle = await metro.bundleWith("P2");
    expect(bundle.status).toBe(200);
    expect(markers(bundle.text)).toEqual(["P2"]);
  }, 60_000);

  it("bundles a module once its first build writes the proxy, without a restart", async () => {
    const metro = await serve();
    const first = await metro.fetchBundle();
    expect(first.status).toBe(500);
    expect(first.text).toMatch(/a\.lucent\.ts has not been compiled/);

    metro.build("P1");
    const bundle = await metro.bundleWith("P1");
    expect(bundle.status).toBe(200);
    expect(markers(bundle.text)).toEqual(["P1"]);
  }, 60_000);
});
