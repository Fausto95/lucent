/**
 * Fresh-install smoke test: packs every @lucent-lang package as it would be
 * published, installs the tarballs into an empty project with npm, and runs
 * the installed CLI there (no tsx, no workspace links), with a Lucent
 * package (examples/lucent-haptics) installed from its tarball too.
 *
 *   tsx scripts/smoke-install.ts
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkAvailable } from "../packages/bindgen/src/provider.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["core", "sdk-ios", "sdk-android", "bindgen", "runtime", "compiler", "cli", "metro", "expo", "ts-plugin"];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-smoke-"));

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

console.log("• packing");
const tarballs: Record<string, string> = {};
for (const p of packages) {
  const out = sh("pnpm", ["pack", "--pack-destination", work], path.join(root, "packages", p)).trim().split("\n").pop()!;
  const name = JSON.parse(fs.readFileSync(path.join(root, "packages", p, "package.json"), "utf8")).name as string;
  tarballs[name] = `file:${path.isAbsolute(out) ? out : path.join(work, path.basename(out))}`;
}

// A Lucent package, as an app would install one from npm.
const haptics = sh("pnpm", ["pack", "--pack-destination", work], path.join(root, "examples/lucent-haptics")).trim().split("\n").pop()!;
tarballs["lucent-haptics"] = `file:${path.isAbsolute(haptics) ? haptics : path.join(work, path.basename(haptics))}`;

console.log("• installing into an empty project");
const app = path.join(work, "app");
fs.mkdirSync(path.join(app, "src"), { recursive: true });
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "smoke", private: true, dependencies: tarballs, overrides: tarballs }, null, 2));
sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);
sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--save-dev", "typescript@~5.9.3"], app);

const installed = path.join(app, "node_modules/@lucent-lang");
for (const p of ["compiler/src", "cli/src"]) if (fs.existsSync(path.join(installed, p))) throw new Error(`${p} should not be published`);

fs.writeFileSync(
  path.join(app, "src/hello.lucent.ts"),
  `import { delay } from "@lucent-lang/core";
export function greet(name: string): string {
  return \`hello \${name.toUpperCase()}\`.replace(/L+/g, "l");
}
export async function later(ms: number): Promise<number> {
  await delay(ms);
  return ms;
}
`,
);

// A module for both platforms: the SDK schemas and lucent:* declarations are published too.
fs.writeFileSync(
  path.join(app, "src/device.lucent.ts"),
  'import { PLATFORM } from "lucent:platform";\nimport { UIDevice } from "lucent:ios/UIKit";\nimport { Build_VERSION } from "lucent:android/android.os";\nimport { main } from "lucent:thread";\nexport async function systemName(): Promise<string> {\n  if (PLATFORM === "ios") return main(() => UIDevice.current.systemName);\n  else return `Android ${Build_VERSION.RELEASE ?? ""}`;\n}\n',
);

console.log("• lucent build (installed CLI)");
console.log(sh(path.join(app, "node_modules/.bin/lucent"), ["build"], app).trim());
const native = path.join(app, ".lucent/native");
// The platforms this machine has an SDK for (a Linux runner has no iOS SDK).
const targets = (["ios", "android"] as const).filter((p) => sdkAvailable(p));
if (!targets.length) throw new Error("no platform SDK on this machine");
const generated = { ios: ["cpp/generated/ios/m_hello.cpp", "cpp/generated/ios/m_device.mm"], android: ["cpp/generated/android/m_hello.cpp", "cpp/generated/android/m_device.cpp"] };
for (const f of ["LucentNative.podspec", "android/CMakeLists.txt", ...targets.flatMap((t) => generated[t]), "cpp/third_party/quickjs/libregexp.c", "js/hello.js", "js/device.js", "js/lucent-haptics/haptics.js"]) {
  if (!fs.existsSync(path.join(native, f))) throw new Error(`missing ${f}`);
}
sh("clang++", ["-std=c++20", "-fsyntax-only", `-I${native}/cpp`, `-I${native}/cpp/generated/${targets[0]}`, path.join(native, `cpp/generated/${targets[0]}/m_hello.cpp`)], app);
// The installed Lucent package's modules are built under its name.
const modules = JSON.parse(fs.readFileSync(path.join(native, "manifest.json"), "utf8")).modules as string[];
for (const m of ["lucent-haptics/haptics"]) if (!modules.includes(m)) throw new Error(`the installed lucent-haptics was not built: ${modules.join(", ")}`);

console.log("• Metro and Expo integrations load");
sh(process.execPath, ["-e", 'require("@lucent-lang/metro").withLucent({}); require.resolve("@lucent-lang/expo")'], app, { LUCENT_WATCH: "0" });

console.log("• editor diagnostics through tsserver and @lucent-lang/ts-plugin");
fs.writeFileSync(path.join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "es2022", noEmit: true, plugins: [{ name: "@lucent-lang/ts-plugin" }] }, include: ["src"] }));
const bad = path.join(app, "src/bad.lucent.ts");
fs.writeFileSync(bad, "export function f(): number {\n  var x = 1;\n  return x;\n}\n");
const codes = await editorDiagnostics(bad);
if (!codes.includes(1001)) throw new Error(`expected LUCENT1001 from the plugin, got ${JSON.stringify(codes)}`);
fs.rmSync(bad);

console.log(`✓ fresh install works (${work})`);

/** Opens `file` in the installed tsserver and polls until Lucent diagnostics appear (the plugin loads the compiler asynchronously). */
async function editorDiagnostics(file: string): Promise<number[]> {
  const server = spawn(process.execPath, [path.join(app, "node_modules/typescript/lib/tsserver.js"), "--disableAutomaticTypingAcquisition"], { cwd: app, stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map<number, (body: unknown) => void>();
  let buffer = "";
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let nl; (nl = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      const msg = JSON.parse(line) as { type: string; request_seq?: number; body?: unknown };
      if (msg.type === "response" && msg.request_seq !== undefined) pending.get(msg.request_seq)?.(msg.body);
    }
  });
  let seq = 0;
  const request = (command: string, args: object) =>
    new Promise<unknown>((resolve) => {
      pending.set(++seq, resolve);
      server.stdin.write(`${JSON.stringify({ seq, type: "request", command, arguments: args })}\n`);
    });
  try {
    await request("open", { file });
    for (let attempt = 0; attempt < 100; attempt++) {
      const diags = (await request("semanticDiagnosticsSync", { file })) as { code: number; source?: string }[];
      const lucent = diags.filter((d) => d.source === "lucent").map((d) => d.code);
      if (lucent.length) return lucent;
      await new Promise((r) => setTimeout(r, 200));
    }
    return [];
  } finally {
    server.kill();
  }
}
