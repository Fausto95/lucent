/**
 * Fills @lucent-lang/sdk-ios and @lucent-lang/sdk-android with the schemas of
 * EVERY module of the installed SDKs (no list), for machines without an SDK
 * (editors, Linux CI). Run in CI before publishing; the output is not
 * committed.
 *
 *   tsx scripts/prebuild-sdk.ts [ios] [android]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sdkModule, sdkModules } from "../packages/bindgen/src/provider.ts";
import type { Platform } from "../packages/bindgen/src/schema.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platforms = (process.argv.slice(2).length ? process.argv.slice(2) : ["ios", "android"]) as Platform[];

for (const platform of platforms) {
  const modules = sdkModules(platform, { prebuilt: false });
  if (!Array.isArray(modules)) {
    console.error(`✗ ${platform}: ${modules.missing}`);
    process.exitCode = 1;
    continue;
  }
  const out = path.join(root, "packages", `sdk-${platform}`);
  let written = 0;
  const failed: string[] = [];
  for (const m of modules) {
    const r = sdkModule(platform, m, { prebuilt: false });
    if ("schema" in r) {
      fs.writeFileSync(path.join(out, `${m}.json`), `${JSON.stringify(r.schema)}\n`);
      written++;
    } else failed.push(`${m}: ${r.missing}`);
  }
  console.log(`✓ ${platform}: ${written}/${modules.length} modules${failed.length ? `; not extracted:\n  ${failed.join("\n  ")}` : ""}`);
}
