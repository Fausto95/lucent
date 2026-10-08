/**
 * The react-native.config.js entry lucent init writes
 * (`require("@lucent-lang/lucent/autolink")(__dirname)`): autolinking reads
 * it on a fresh clone, CI or EAS, where .lucent/ (ignored by git) is
 * missing, so it builds the native package before giving its root.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const autolink = require("../autolink/index.cjs") as {
  (root: string): { root: string };
  staleness(root: string, out: string): string | undefined;
};

function app(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-autolink-")));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.writeFileSync(
    path.join(root, "hello.lucent.ts"),
    "export function hello(): string { return 'hi'; }\n",
  );
  fs.writeFileSync(
    path.join(root, "react-native.config.js"),
    'module.exports = { dependencies: { "lucent": require(process.env.LUCENT_AUTOLINK)(__dirname) } };\n',
  );
  return root;
}

describe("the autolinking entry", () => {
  it("builds the native package on a fresh clone, then links it", () => {
    const root = app();
    const out = path.join(root, ".lucent/native");
    expect(autolink.staleness(root, out)).toMatch(/missing/);

    expect(autolink(root)).toEqual({ root: out });
    expect(fs.existsSync(path.join(out, "react-native.config.js"))).toBe(true);
    expect(fs.existsSync(path.join(out, "js/hello.js"))).toBe(true);
    expect(autolink.staleness(root, out)).toBeUndefined();
  });

  it("builds again when a module changed since the last build", () => {
    const root = app();
    const out = path.join(root, ".lucent/native");
    autolink(root);

    const later = new Date(Date.now() + 10_000);
    fs.writeFileSync(
      path.join(root, "bye.lucent.ts"),
      "export function bye(): string { return 'bye'; }\n",
    );
    fs.utimesSync(path.join(root, "bye.lucent.ts"), later, later);
    expect(autolink.staleness(root, out)).toMatch(/bye\.lucent\.ts changed/);

    autolink(root);
    expect(fs.existsSync(path.join(out, "js/bye.js"))).toBe(true);
  });

  it("is what React Native's config reads, printing nothing on stdout", () => {
    const root = app();
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const r = spawnSync(
      process.execPath,
      [
        "-e",
        `console.log(JSON.stringify(require(${JSON.stringify(path.join(root, "react-native.config.js"))})))`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, LUCENT_AUTOLINK: require.resolve("../autolink/index.cjs") },
      },
    );
    expect(r.status, r.stderr).toBe(0);
    // stdout is the config's JSON alone: `react-native config` prints it there.
    expect(JSON.parse(r.stdout)).toEqual({
      dependencies: { lucent: { root: path.join(root, ".lucent/native") } },
    });
    expect(r.stderr).toMatch(/running lucent build before autolinking/);
  });
});
