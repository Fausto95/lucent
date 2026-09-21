#!/usr/bin/env bun
/**
 * Bundles the entry points that Node (Metro workers, expo prebuild, npx) loads
 * into CommonJS. Bun and TypeScript keep using the sources via export conditions.
 */
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const entries: { entry: string; outfile: string }[] = [
  { entry: "packages/metro/src/transformer.ts", outfile: "packages/metro/dist/transformer.cjs" },
  { entry: "packages/metro/src/index.ts", outfile: "packages/metro/dist/index.cjs" },
  { entry: "packages/expo/src/plugin.ts", outfile: "packages/expo/dist/plugin.cjs" },
  { entry: "packages/cli/src/main.ts", outfile: "packages/cli/dist/main.cjs" },
];

let failed = false;
for (const { entry, outfile } of entries) {
  const result = await Bun.build({
    entrypoints: [join(root, entry)],
    outdir: join(root, outfile, ".."),
    naming: outfile.split("/").pop()!,
    target: "node",
    format: "cjs",
    external: ["oxc-parser", "@oxc-project/types", "@expo/config-plugins", "expo/config-plugins"],
  });
  if (!result.success) {
    failed = true;
    for (const log of result.logs) console.error(log);
  } else {
    console.log(`✓ ${outfile}`);
  }
}
process.exit(failed ? 1 : 0);
