import path from "node:path";
import {
  type ArtifactChange,
  cachedSchema,
  compareArtifacts,
  diffModule,
  diffSymbols,
  displayName,
  type SdkModuleSchema,
  type SymbolChange,
  symbolKey,
} from "@lucent-lang/bindgen";
import { sdkModule } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk } from "../project.ts";
import {
  artifactText,
  LOCK_FILE,
  type Platform,
  readUsage,
  sdkUnavailable,
  usedModules,
} from "../sdk-usage.ts";
import { table } from "../ui/format.ts";

/** A symbol's change, as `--json` reports it. */
interface Entry {
  change: SymbolChange["change"];
  platform: string;
  module: string;
  key: string;
  display: string;
  signature: string;
  details: string[];
}

const entry = (c: SymbolChange): Entry => {
  const s = (c.after ?? c.before)!;
  return {
    change: c.change,
    platform: s.platform,
    module: s.module,
    key: symbolKey(c.before ?? s),
    display: displayName(c.before ?? s),
    signature: s.signature,
    details: c.details,
  };
};

/**
 * `lucent sdk diff`: what the installed SDKs change for the SDK symbols
 * lucent-sdk.lock.json records (the ones the code used when it was
 * locked), found by native identity: removed members, and changes of
 * signature, availability, deprecation or TypeScript name. With `--all`,
 * also the other members of those modules, from the locked schemas this
 * machine's SDK cache still holds. Fails when a used symbol changed or a
 * locked target has no SDK.
 */
export function run({ root, flags, out }: Invocation): number {
  const t = out.theme;

  let lock;
  try {
    lock = readUsage(path.join(root, LOCK_FILE));
  } catch (e) {
    out.error(`${t.error(t.symbols.fail)} ${(e as Error).message}`);
    return 1;
  }
  if (!lock) {
    out.error(
      `${t.error(t.symbols.fail)} no ${LOCK_FILE}: lucent sdk lock records the SDKs to compare with`,
    );
    return 1;
  }

  const sdk = projectSdk(root);
  const unavailable = lock.targets.flatMap((p) => {
    const reason = sdkUnavailable(p, sdk);
    return reason ? [{ platform: p, reason }] : [];
  });
  const available = (p: Platform) => !unavailable.some((u) => u.platform === p);

  const schemaOf = (p: Platform, m: string): SdkModuleSchema | { missing: string } => {
    const r = sdkModule(p, m, sdk);
    return "schema" in r ? r.schema : r;
  };

  const used = diffSymbols(
    lock.symbols.filter((s) => available(s.platform)),
    schemaOf,
  );
  const lockedModules = Object.keys(lock.modules).filter((k) =>
    available(k.split("/")[0] as Platform),
  );
  const artifacts = compareArtifacts(lock.modules, usedModules(lockedModules, sdk));

  // The rest of each module, from the schema the lock was made with.
  const others: SymbolChange[] = [];
  const uncached: string[] = [];
  if (flags.all) {
    const usedKeys = new Set(lock.symbols.map(symbolKey));

    for (const key of lockedModules) {
      const [p, m] = key.split("/") as [Platform, string];
      const ref = lock.modules[key]!.schema;
      const before = ref ? cachedSchema(p, m, ref, sdk) : undefined;
      const after = schemaOf(p, m);

      if (!before) uncached.push(key);
      if (!before || "missing" in after) continue;

      others.push(
        ...diffModule(before, after).filter(
          (c) => c.change !== "unchanged" && !usedKeys.has(symbolKey((c.before ?? c.after)!)),
        ),
      );
    }
  }

  const removed = used.filter((c) => c.change === "removed").length;
  const changed = used.filter((c) => c.change === "changed").length;
  const ok = !unavailable.length && !removed && !changed;

  if (out.json) {
    out.data({
      ok,
      unavailable,
      artifacts,
      used: used.map(entry),
      ...(flags.all ? { others: others.map(entry), uncached } : {}),
    });
    return ok ? 0 : 1;
  }

  for (const u of unavailable) out.error(`${t.error(t.symbols.fail)} ${u.platform}: ${u.reason}`);

  print(out, artifacts, [...used, ...others]);

  for (const key of uncached)
    out.print(
      t.dim(
        `lucent:${key}: the locked schema is not in this machine's SDK cache: only its used symbols are compared`,
      ),
    );

  const total = used.length;
  out.print(
    removed + changed
      ? `${removed + changed} of ${total} used symbols changed: ${removed} removed, ${changed} changed ${t.dim(`(lucent sdk lock records the installed SDKs once the code is updated)`)}`
      : `${t.success(t.symbols.ok)} none of the ${total} used symbols changed`,
  );

  return ok ? 0 : 1;
}

/** Each module's artifact change, then its symbol changes, unchanged ones left out. */
function print(out: Invocation["out"], artifacts: ArtifactChange[], changes: SymbolChange[]): void {
  const t = out.theme;
  const byModule = new Map<string, { artifacts?: ArtifactChange; changes: SymbolChange[] }>();
  const of = (key: string) => byModule.get(key) ?? byModule.set(key, { changes: [] }).get(key)!;

  for (const a of artifacts) of(a.module).artifacts = a;
  for (const c of changes) {
    if (c.change === "unchanged") continue;

    const s = (c.before ?? c.after)!;
    of(`${s.platform}/${s.module}`).changes.push(c);
  }

  for (const [key, m] of [...byModule].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [platform] = key.split("/");
    out.print(`${t.brand(platform!)}  ${t.bold(`lucent:${key}`)}`);

    if (m.artifacts) out.print(`  ${t.dim("artifacts")}  ${artifactText(m.artifacts)}`);

    const rows = m.changes.map((c) => [
      `  ${c.change === "added" ? t.dim(c.change) : c.change === "changed" ? t.warn(c.change) : t.error(c.change)}`,
      displayName((c.before ?? c.after)!),
      // Why it changed, why its module is gone, or else its signature.
      c.details.join("; ") || (c.after ?? c.before)!.signature,
    ]);
    for (const line of table(rows)) out.print(line.trimEnd());
    out.print("");
  }
}
