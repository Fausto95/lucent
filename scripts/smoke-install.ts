/**
 * Fresh-install smoke test: packs every @lucent-lang package as it would be
 * published, installs the tarballs into an empty project with npm, and runs
 * the installed CLI there (no tsx, no workspace links).
 *
 *   tsx scripts/smoke-install.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["core", "runtime", "compiler", "cli", "metro", "expo"];
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

console.log("• installing into an empty project");
const app = path.join(work, "app");
fs.mkdirSync(path.join(app, "src"), { recursive: true });
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "smoke", private: true, dependencies: tarballs, overrides: tarballs }, null, 2));
sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);

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

console.log("• lucent build (installed CLI)");
console.log(sh(path.join(app, "node_modules/.bin/lucent"), ["build"], app).trim());
const native = path.join(app, ".lucent/native");
for (const f of ["LucentNative.podspec", "android/CMakeLists.txt", "cpp/generated/m_hello.cpp", "cpp/third_party/quickjs/libregexp.c", "js/hello.js"]) {
  if (!fs.existsSync(path.join(native, f))) throw new Error(`missing ${f}`);
}
sh("clang++", ["-std=c++20", "-fsyntax-only", `-I${native}/cpp`, `-I${native}/cpp/generated`, path.join(native, "cpp/generated/m_hello.cpp")], app);

console.log("• Metro and Expo integrations load");
sh(process.execPath, ["-e", 'require("@lucent-lang/metro").withLucent({}); require.resolve("@lucent-lang/expo")'], app, { LUCENT_WATCH: "0" });

console.log(`✓ fresh install works (${work})`);
