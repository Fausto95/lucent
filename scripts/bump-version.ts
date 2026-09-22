/**
 * Moves the root package.json and every packages/* package.json to the next lockstep version.
 * Usage: tsx scripts/bump-version.ts <major|minor|patch>. Prints the new version.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpKinds, bumpVersion, isBump, replaceVersion } from "./version.ts";

const bump = process.argv[2];
if (!isBump(bump)) {
  console.error(`Usage: tsx scripts/bump-version.ts <${bumpKinds.join("|")}>`);
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const packageDirs = readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
const files = ["package.json", ...packageDirs.map((entry) => join("packages", entry.name, "package.json"))];

const sources = files.map((file) => {
  const text = readFileSync(join(root, file), "utf8");
  return { file, text, version: (JSON.parse(text) as { version: string }).version };
});

const current = sources[0]!.version;
const drifted = sources.filter((source) => source.version !== current).map((source) => source.file);
if (drifted.length > 0) {
  throw new Error(`Every package must be at ${current} before bumping; drifted: ${drifted.join(", ")}`);
}

const next = bumpVersion(current, bump);
for (const { file, text } of sources) writeFileSync(join(root, file), replaceVersion(text, current, next));
console.log(next);
