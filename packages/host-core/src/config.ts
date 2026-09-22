import { resolveCapabilities, type PlatformConfig } from "./capabilities.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseNativeConfig, validateLibrary, type LibraryModule } from "@lucent-lang/compiler";

export interface LucentConfig {
  capabilities: string[];
  platformConfig: PlatformConfig;
  /** Trusted native binding manifests, indexed by their import specifier. */
  libraries: Record<string, LibraryModule>;
}

export function loadLucentConfig(root: string): LucentConfig {
  const ts = join(root, "lucent.config.ts");
  const json = join(root, "lucent.config.json");
  if (existsSync(ts) && existsSync(json)) throw new Error("Use one lucent.config.ts or lucent.config.json, not both");
  const file = existsSync(ts) ? ts : json;
  const value = (
    existsSync(file)
      ? file === ts
        ? parseNativeConfig(readFileSync(file, "utf8"), file)
        : JSON.parse(readFileSync(file, "utf8"))
      : {}
  ) as Partial<LucentConfig>;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${file}: expected an object`);
  if (Object.keys(value).some((key) => !["capabilities", "libraries"].includes(key)))
    throw new Error(`${file}: unknown config key`);
  const resolved = resolveCapabilities(value.capabilities);
  if (
    value.libraries !== undefined &&
    (typeof value.libraries !== "object" || value.libraries === null || Array.isArray(value.libraries))
  )
    throw new Error(`${file}: libraries must be an object`);
  for (const [name, entry] of Object.entries(value.libraries ?? {})) {
    const library =
      typeof entry === "string" ? (JSON.parse(readFileSync(resolve(root, entry), "utf8")) as LibraryModule) : entry;
    value.libraries![name] = library;
    if (!name.startsWith("@lucent-lang/") || !library || typeof library.source !== "string")
      throw new Error(`${file}: invalid library ${name}`);
    const metadataErrors = validateLibrary(library);
    if (metadataErrors.length) throw new Error(`${file}: ${name}: ${metadataErrors.join(" ")}`);
    for (const binding of Object.values(library.bindings ?? {})) {
      if (binding.nativeOnly !== undefined && typeof binding.nativeOnly !== "boolean")
        throw new Error(`${file}: invalid nativeOnly flag`);
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
      if (
        binding.platforms !== undefined &&
        (!Array.isArray(binding.platforms) ||
          !binding.platforms.length ||
          binding.platforms.some((p) => !["ios", "android"].includes(p)))
      )
        throw new Error(`${file}: invalid platforms`);
      if (binding.cost !== undefined && !["cpu", "io"].includes(binding.cost))
        throw new Error(`${file}: invalid binding cost`);
      if (binding.platformQuery !== undefined && typeof binding.platformQuery !== "boolean")
        throw new Error(`${file}: invalid platform query`);
      if (binding.thread !== undefined && !["caller", "main", "worker"].includes(binding.thread))
        throw new Error(`${file}: invalid thread`);
    }
  }
  return { capabilities: resolved.names, platformConfig: resolved.platformConfig, libraries: value.libraries ?? {} };
}

/** Metro starts at the source file and uses the nearest app config/package boundary. */
export function sourceProjectRoot(fileName: string): string {
  let dir = dirname(fileName);
  while (
    !existsSync(join(dir, "lucent.config.ts")) &&
    !existsSync(join(dir, "lucent.config.json")) &&
    !existsSync(join(dir, "package.json"))
  ) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}
