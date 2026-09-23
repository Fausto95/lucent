/**
 * Generates @lucent-lang/sdk-android: binding schemas for every package of
 * the Android SDK's android.jar, at the API level React Native compiles
 * against, with API levels from its api-versions.xml.
 *
 *   ANDROID_HOME=… tsx scripts/gen-sdk-android.ts [platform, default android-37.0]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAndroid } from "../packages/bindgen/src/android.ts";
import { ZipArchive } from "../packages/bindgen/src/zip.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");
const platform = path.join(sdk, "platforms", process.argv[2] ?? "android-37.0");
const jar = path.join(platform, "android.jar");
const out = path.join(root, "packages/sdk-android");

const packages = new Set<string>();
for (const n of new ZipArchive(jar).names()) if (n.endsWith(".class")) packages.add(n.slice(0, n.lastIndexOf("/")).replace(/\//g, "."));
const modules = extractAndroid({ jars: [jar], apiVersions: path.join(platform, "data/api-versions.xml"), packages: [...packages].sort() });

for (const f of fs.readdirSync(out)) if (f.endsWith(".json") && f !== "package.json") fs.rmSync(path.join(out, f));
let members = 0;
let skipped = 0;
for (const m of modules) {
  if (!m.types.length) continue;
  fs.writeFileSync(path.join(out, `${m.module}.json`), `${JSON.stringify(m)}\n`);
  for (const t of m.types) if (t.kind === "class") members += (t.methods?.length ?? 0) + (t.properties?.length ?? 0) + (t.constructors?.length ?? 0);
  skipped += m.skipped?.length ?? 0;
}
fs.writeFileSync(path.join(out, "SOURCE"), `${path.basename(platform)} ${fs.readFileSync(path.join(platform, "source.properties"), "utf8").match(/Pkg\.Revision=(.*)/)?.[1] ?? ""}\n`);
console.log(`✓ packages/sdk-android: ${modules.length} packages, ${members} members, ${skipped} skipped (${path.basename(platform)})`);
