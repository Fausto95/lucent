import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LibraryModule } from "@lucent-lang/compiler";

export interface LucentConfig {
  capabilities: string[];
  /** Trusted native binding manifests, indexed by their import specifier. */
  libraries: Record<string, LibraryModule>;
}

export function loadLucentConfig(root: string): LucentConfig {
  const file = join(root, "lucent.config.json");
  if (!existsSync(file)) return { capabilities: [], libraries: {} };
  const value = JSON.parse(readFileSync(file, "utf8")) as Partial<LucentConfig>;
  if (typeof value !== "object" || value === null) throw new Error(`${file}: expected an object`);
  if (
    value.capabilities !== undefined &&
    (!Array.isArray(value.capabilities) || value.capabilities.some((c) => typeof c !== "string"))
  )
    throw new Error(`${file}: capabilities must be a list of names`);
  if (
    value.libraries !== undefined &&
    (typeof value.libraries !== "object" || value.libraries === null || Array.isArray(value.libraries))
  )
    throw new Error(`${file}: libraries must be an object`);
  for (const [name, library] of Object.entries(value.libraries ?? {})) {
    if (!name.startsWith("@lucent-lang/") || !library || typeof library.source !== "string")
      throw new Error(`${file}: invalid library ${name}`);
    for (const binding of Object.values(library.bindings ?? {})) {
      for (const language of ["swift", "kotlin"] as const) {
        if (!Array.isArray(binding[language]) || binding[language].some((line) => typeof line !== "string"))
          throw new Error(`${file}: ${name} needs ${language} body lines`);
      }
      for (const key of ["capabilities", "swiftImports", "kotlinImports"] as const) {
        if (
          binding[key] !== undefined &&
          (!Array.isArray(binding[key]) || binding[key].some((item) => typeof item !== "string"))
        )
          throw new Error(`${file}: invalid ${key}`);
      }
      if (binding.thread !== undefined && !["caller", "main", "worker"].includes(binding.thread))
        throw new Error(`${file}: invalid thread`);
    }
  }
  return { capabilities: value.capabilities ?? [], libraries: value.libraries ?? {} };
}

/** Metro starts at the source file and uses the nearest app config/package boundary. */
export function sourceProjectRoot(fileName: string): string {
  let dir = dirname(fileName);
  while (!existsSync(join(dir, "lucent.config.json")) && !existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}
