/**
 * Swift packages built into the cache (TA32), with stand-ins for git,
 * swift and xcodebuild: what the build does with the cache, not Xcode.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const src = path.join(import.meta.dirname, "../src/swift-packages.ts");

/** Tools that log each call to `log` and build a package with one Swift module, slowly. */
function fakeTools(dir: string, log: string): string {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const tool = (name: string, body: string) =>
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, {
      mode: 0o755,
    });
  tool("git", 'if [ "$1" = clone ]; then mkdir -p "$4"; fi');
  tool("swift", `echo '{"products":[{"name":"Gauges","type":{"library":["automatic"]}}]}'`);
  tool(
    "xcodebuild",
    `if [ "$1" = -version ]; then echo "Xcode 26.0"; exit 0; fi
sleep 1
while [ $# -gt 0 ]; do if [ "$1" = -derivedDataPath ]; then d="$2"; fi; shift; done
mkdir -p "$d/Build/Products/Debug-iphonesimulator/Gauges.swiftmodule"`,
  );
  return bin;
}

describe("Swift packages in the cache", () => {
  it("builds a package once when builds ask for it at the same time", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-spm-"));
    const log = path.join(dir, "calls.log");
    const bin = fakeTools(dir, log);
    const cacheDir = path.join(dir, "cache");
    const app = {
      project: path.join(dir, "App.xcodeproj"),
      deploymentTarget: "16.4",
      packages: [{ identity: "gauges", location: "https://example.com/Gauges", revision: "abc" }],
    };
    const script = `import { swiftPackages } from ${JSON.stringify(src)};
console.log(JSON.stringify(swiftPackages(${JSON.stringify(app)}, { cacheDir: ${JSON.stringify(cacheDir)} })));`;
    const one = () =>
      new Promise<string>((resolve, reject) => {
        const p = spawn(process.execPath, ["--input-type=module", "-e", script], {
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        });
        let out = "";
        p.stdout.on("data", (d: Buffer) => (out += d));
        p.stderr.on("data", (d: Buffer) => (out += d));
        p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
      });

    const results = (await Promise.all([one(), one(), one()])).map(
      (o) => JSON.parse(o.trim().split("\n").at(-1)!) as { modules: { module: string }[] },
    );

    for (const r of results) expect(r.modules.map((m) => m.module)).toEqual(["Gauges"]);
    const builds = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("xcodebuild build"));
    expect(builds).toHaveLength(1);
  }, 60_000);
});
