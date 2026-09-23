/**
 * Generates @lucent-lang/sdk-ios: binding schemas for the Apple frameworks
 * platform modules can import, from the installed Xcode's iOS simulator SDK
 * (symbol graphs, plus clang for enum values).
 *
 *   tsx scripts/gen-sdk-ios.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractIos } from "../packages/bindgen/src/ios.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "packages/sdk-ios");
// The frameworks the M2.1 parity ports need; more join as ports need them.
const frameworks = ["Foundation", "UIKit", "Security"];

const modules = extractIos({ modules: frameworks });
for (const f of fs.readdirSync(out)) if (f.endsWith(".json") && f !== "package.json") fs.rmSync(path.join(out, f));
let members = 0;
let skipped = 0;
for (const m of modules) {
  fs.writeFileSync(path.join(out, `${m.module}.json`), `${JSON.stringify(m)}\n`);
  for (const t of m.types) members += t.kind === "class" ? (t.methods?.length ?? 0) + (t.properties?.length ?? 0) + (t.constructors?.length ?? 0) : t.cases.length;
  members += (m.functions?.length ?? 0) + (m.constants?.length ?? 0);
  skipped += m.skipped?.length ?? 0;
}
const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"], { encoding: "utf8" }).stdout.trim();
fs.writeFileSync(path.join(out, "SOURCE"), `iphonesimulator ${sdk}\n`);
console.log(`✓ packages/sdk-ios: ${modules.length} modules, ${members} members, ${skipped} skipped (iOS ${sdk} SDK)`);
