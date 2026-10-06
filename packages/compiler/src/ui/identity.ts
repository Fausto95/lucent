/**
 * Where a component comes from: its package and its module's path in it.
 * A Lucent package's modules are named by their path under its sources, as
 * their module names are; an app's by their path under the directory of
 * the package.json above them. Platform files share their module's path.
 */
import fs from "node:fs";
import path from "node:path";
import { LUCENT_EXTENSION, lucentPackageOf } from "../packages.ts";
import { PLATFORM_EXTENSION } from "../program.ts";

export interface ModuleIdentity {
  readonly package: string;
  readonly module: string;
}

/** The package and module path of a Lucent file, or undefined when no package.json names it. */
export function moduleIdentity(file: string): ModuleIdentity | undefined {
  const lucent = lucentPackageOf(file);
  const owner = lucent ? { name: lucent.name, root: lucent.sources } : nearestPackage(file);

  if (!owner) return undefined;

  const relative = path.relative(owner.root, path.resolve(file)).split(path.sep).join("/");
  const module = relative.replace(PLATFORM_EXTENSION, "").replace(LUCENT_EXTENSION, "");

  return { package: owner.name, module };
}

/** The nearest package.json above a file: its name and directory, if it has a name. */
function nearestPackage(file: string): { name: string; root: string } | undefined {
  for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");

    if (fs.existsSync(manifest)) {
      const name = nameIn(fs.readFileSync(manifest, "utf8"));

      return name ? { name, root: dir } : undefined;
    }

    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The `name` of a package.json's text, if it parses and has one. */
function nameIn(text: string): string | undefined {
  try {
    const name = (JSON.parse(text) as { name?: unknown }).name;

    return typeof name === "string" && name ? name : undefined;
  } catch {
    return undefined;
  }
}
