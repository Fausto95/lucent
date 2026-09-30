/**
 * What a build used of the SDKs (.lucent/sdk-usage.json), the SDK lock
 * that records it for reproducible builds (lucent-sdk.lock.json), and why
 * a frozen build cannot go on with the SDKs installed now.
 */
import fs from "node:fs";
import path from "node:path";
import {
  type ArtifactChange,
  compareArtifacts,
  displayName,
  type SdkUsage,
  sdkModuleArtifacts,
  sdkSchemaEntry,
  symbolKey,
  USAGE_FORMAT,
  type UsedModule,
  type UsedSymbol,
} from "@lucent-lang/bindgen";
import { sdkAvailable, sdkModule, type SdkOptions } from "@lucent-lang/compiler";

export type Platform = "ios" | "android";

const PLATFORMS: readonly string[] = ["ios", "android"] satisfies Platform[];

/** Why `platform`'s SDK is unavailable; undefined when it is available. */
export function sdkUnavailable(platform: Platform, sdk: SdkOptions): string | undefined {
  if (sdkAvailable(platform, sdk)) return undefined;

  const why = sdkModule(platform, platform === "ios" ? "Foundation" : "android.os", sdk);
  return "missing" in why ? why.missing : `no ${platform} SDK`;
}

/** The SDK lock, beside package.json: committed with the app. */
export const LOCK_FILE = "lucent-sdk.lock.json";

/** What the last successful build or check used. */
export const USAGE_FILE = ".lucent/sdk-usage.json";

/** How this build read `lucent:<platform>/<module>` (its schema loaded): none when it has no schema. */
export function usedModule(
  platform: Platform,
  module: string,
  sdk: SdkOptions,
): UsedModule | undefined {
  const artifacts = sdkModuleArtifacts(platform, module, sdk);
  if (!artifacts.length) return undefined;

  const schema = sdkSchemaEntry(platform, module, sdk);
  return {
    artifacts: artifacts.map((a) => `${a.id}#${a.contentHash}`).sort(),
    ...(schema ? { schema } : {}),
  };
}

/** How this build reads each of `modules` (`<platform>/<module>`), by key. */
export function usedModules(
  modules: Iterable<string>,
  sdk: SdkOptions,
): Record<string, UsedModule> {
  const out: Record<string, UsedModule> = {};

  for (const key of [...new Set(modules)].sort()) {
    const [platform, module] = key.split("/") as [Platform, string];
    const used = usedModule(platform, module, sdk);
    if (used) out[key] = used;
  }

  return out;
}

/** What a build used: the symbols its compile listed, their modules and those it imports. */
export function sdkUsage(
  symbols: UsedSymbol[],
  targets: Platform[],
  imports: string[],
  sdk: SdkOptions,
): SdkUsage {
  return {
    format: USAGE_FORMAT,
    targets: [...targets].sort(),
    modules: usedModules([...imports, ...symbols.map((s) => `${s.platform}/${s.module}`)], sdk),
    symbols,
  };
}

/** A usage report or lock; undefined when there is none, an error when it cannot be read. */
export function readUsage(file: string): SdkUsage | undefined {
  if (!fs.existsSync(file)) return undefined;

  let value: Partial<SdkUsage>;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SdkUsage>;
  } catch (e) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${(e as Error).message}`, {
      cause: e,
    });
  }

  if (value.format !== USAGE_FORMAT)
    throw new Error(
      `${path.basename(file)} has format ${value.format ?? "none"}; this Lucent reads format ${USAGE_FORMAT}: run lucent sdk lock again`,
    );
  if (!Array.isArray(value.targets) || !value.modules || !Array.isArray(value.symbols))
    throw new Error(`${path.basename(file)} is incomplete: run lucent sdk lock again`);

  const unknown = [
    ...value.targets,
    ...Object.keys(value.modules).map((k) => k.split("/")[0]!),
    ...value.symbols.map((s) => s.platform),
  ].filter((p) => !PLATFORMS.includes(p));
  if (unknown.length)
    throw new Error(`${path.basename(file)}: unknown target ${[...new Set(unknown)].join(", ")}`);

  return value as SdkUsage;
}

/** Whether `file` holds a usage report or lock this Lucent reads. */
export function usageReadable(file: string): boolean {
  try {
    return readUsage(file) !== undefined;
  } catch {
    return false;
  }
}

/** Writes a usage report or lock whole: a reader never sees half of it. */
export function writeUsage(file: string, usage: SdkUsage): void {
  const tmp = `${file}.${process.pid}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(usage, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** A module's artifacts that differ from the lock's: `was → now`, or that the lock does not record it. */
export function artifactText(c: ArtifactChange): string {
  if (!c.locked) return "not in the lock";

  const gone = c.locked.filter((a) => !c.found.includes(a));
  const added = c.found.filter((a) => !c.locked!.includes(a));

  return `${gone.join(", ") || "-"} → ${added.join(", ") || "-"}`;
}

/**
 * Why a frozen build cannot go on: modules read from other artifacts than
 * the lock records (or not recorded), and used symbols it does not record.
 */
export function lockProblems(
  lock: SdkUsage,
  found: Record<string, UsedModule>,
  symbols: UsedSymbol[] = [],
): string[] {
  const problems = compareArtifacts(lock.modules, found).map(
    (c) => `lucent:${c.module}: ${artifactText(c)}`,
  );

  const locked = new Set(lock.symbols.map(symbolKey));
  const unlocked = symbols.filter((s) => !locked.has(symbolKey(s)));
  if (unlocked.length) {
    const names = unlocked.slice(0, 3).map(displayName).join(", ");
    const more = unlocked.length > 3 ? ` and ${unlocked.length - 3} more` : "";

    problems.push(
      `${unlocked.length} SDK symbol${unlocked.length === 1 ? " the code uses is" : "s the code uses are"} not in ${LOCK_FILE}: ${names}${more}`,
    );
  }

  return problems;
}

/** The fatal message of a frozen build that `problems` stop. */
export function frozenFailure(problems: string[]): string {
  return [
    `the SDKs or SDK symbols differ from ${LOCK_FILE}:`,
    ...problems.map((p) => `  ${p}`),
    "lucent sdk diff shows what the installed SDKs change for the app; lucent sdk lock records them",
  ].join("\n");
}
