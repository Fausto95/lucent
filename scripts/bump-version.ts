/**
 * Bumps the version of every published @lucent-lang package together and
 * prints the new version.
 *
 *   node scripts/bump-version.ts patch|minor|major
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kind = process.argv[2] ?? "patch";
const dirs = fs.readdirSync(path.join(root, "packages")).map((d) => path.join(root, "packages", d, "package.json")).filter((f) => fs.existsSync(f));
const manifests = dirs.map((f) => ({ f, pkg: JSON.parse(fs.readFileSync(f, "utf8")) })).filter((m) => !m.pkg.private && m.pkg.name?.startsWith("@lucent-lang/"));
const current = manifests[0]!.pkg.version as string;
const [major, minor, patch] = current.split("-")[0]!.split(".").map(Number) as [number, number, number];
const next = kind === "major" ? `${major + 1}.0.0` : kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
for (const m of manifests) {
  m.pkg.version = next;
  fs.writeFileSync(m.f, JSON.stringify(m.pkg, null, 2) + "\n");
}
process.stdout.write(next);
