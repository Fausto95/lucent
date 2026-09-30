/**
 * SDK symbols as an app depends on them: each type and member keyed by its
 * native identity, with what a use relies on (signature, availability,
 * deprecation, TypeScript name), and diffs of those between two versions
 * of a module. Plain data in, plain data out.
 */
import type { Role } from "./binding-plan.ts";
import {
  formatSchemaType,
  type Platform,
  type SdkCallable,
  type SdkClassSchema,
  type SdkEnumSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkParam,
  type SdkPropertySchema,
  type SdkStructSchema,
  type SymbolId,
} from "./schema.ts";

/** The version of the usage report and SDK lock format. */
export const USAGE_FORMAT = 1;

export type SymbolKind = "type" | "constructor" | "method" | "property" | "function" | "constant";

/** A type or member of an SDK module, as a use of it depends on it. */
export interface SdkSymbol {
  platform: Platform;
  module: string;
  /** The declaring type's Lucent name; none for types, C functions and constants. */
  owner?: string;
  kind: SymbolKind;
  /** The Lucent name (`setValue_long`); `constructor` for constructors. */
  name: string;
  static?: true;
  symbol?: SymbolId;
  /** What Lucent declares it as: `(string, int) => void`, `string readonly`, `class extends X`. */
  signature: string;
  since?: number | string;
  deprecated?: true;
  /** An enum's case names. */
  cases?: string[];
}

/** A symbol the app's code uses, and how (types named by used members have no roles). */
export interface UsedSymbol extends SdkSymbol {
  roles?: Role[];
}

/** A module the used symbols belong to, as the build read it. */
export interface UsedModule {
  /** The artifacts its schema was read from: `id#contentHash`, sorted. */
  artifacts: string[];
  /** Where the SDK cache keeps that schema (`<scope>/<entry>`, no machine paths). */
  schema?: string;
}

/** What a build used of the SDKs: `.lucent/sdk-usage.json`, and the SDK lock. */
export interface SdkUsage {
  format: number;
  /** The targets the build compiled platform code for. */
  targets: Platform[];
  /** `<platform>/<module>` → how the build read it. */
  modules: Record<string, UsedModule>;
  /** Sorted by key. */
  symbols: UsedSymbol[];
}

type Member = SdkMethodSchema | SdkPropertySchema | SdkCallable;
type Declaration = SdkClassSchema | SdkEnumSchema | SdkStructSchema;

/**
 * A symbol's identity within its module: its native symbol when known,
 * else its name and signature. The kind and owner stay in it, since a
 * getter property and its method, or members an extension gives several
 * types, share a native symbol.
 */
export function symbolKey(s: SdkSymbol): string {
  const id = s.symbol ?? `${s.static ? "static " : ""}${s.name} ${s.signature}`;
  return `${s.platform}/${s.module}/${s.owner ?? ""}/${s.kind}:${id}`;
}

/** How messages name a symbol: `UIDevice.batteryLevel`, `new Tracker(string)`. */
export function displayName(s: SdkSymbol): string {
  if (s.kind === "constructor") return `new ${s.owner}${s.signature}`;
  return s.owner ? `${s.owner}.${s.name}` : s.name;
}

/** A type as a use depends on it. */
export function typeSymbol(platform: Platform, module: string, t: Declaration): SdkSymbol {
  const signature =
    t.kind === "enum"
      ? "enum"
      : t.kind === "struct"
        ? `struct { ${t.fields.map((f) => `${f.name}: ${formatSchemaType(f.type)}`).join(", ")} }`
        : [
            t.interface ? "interface" : "class",
            t.extends && `extends ${t.extends}`,
            t.implements?.length && `implements ${t.implements.join(", ")}`,
          ]
            .filter(Boolean)
            .join(" ");

  return {
    platform,
    module,
    kind: "type",
    name: t.name,
    ...(t.symbol ? { symbol: t.symbol } : {}),
    signature,
    ...(t.kind === "class" && t.since !== undefined ? { since: t.since } : {}),
    ...(t.kind === "enum" ? { cases: t.cases.map((c) => c.name) } : {}),
  };
}

/** A member of `owner` (none for C functions and constants) as a use depends on it. */
export function memberSymbol(
  platform: Platform,
  module: string,
  owner: SdkClassSchema | undefined,
  member: Member,
): SdkSymbol {
  const kind: SymbolKind =
    "type" in member
      ? owner
        ? "property"
        : "constant"
      : "returns" in member
        ? owner
          ? "method"
          : "function"
        : "constructor";

  return {
    platform,
    module,
    ...(owner ? { owner: owner.name } : {}),
    kind,
    name: "name" in member ? member.name : "constructor",
    ...("static" in member && member.static ? { static: true as const } : {}),
    ...(member.symbol ? { symbol: member.symbol } : {}),
    signature: signatureOf(member),
    ...(member.since !== undefined ? { since: member.since } : {}),
    ...(member.deprecated ? { deprecated: true as const } : {}),
  };
}

function signatureOf(member: Member): string {
  if ("type" in member)
    return `${formatSchemaType(member.type)}${member.readonly ? " readonly" : ""}`;

  const params = `(${member.params.map(paramText).join(", ")})`;
  const throws = ("throws" in member && member.throws) || member.swift?.throws ? " throws" : "";
  const async = member.swift?.async ? " async" : "";

  return "returns" in member
    ? `${params} => ${formatSchemaType(member.returns)}${async}${throws}`
    : `${params}${async}${throws}`;
}

const paramText = (p: SdkParam) =>
  `${formatSchemaType(p.type)}${p.defaulted === "optional" ? " =" : ""}`;

const symbolsOf = new WeakMap<SdkModuleSchema, SdkSymbol[]>();

/** Every type and member a schema declares. */
export function sdkSymbols(schema: SdkModuleSchema): SdkSymbol[] {
  const known = symbolsOf.get(schema);
  if (known) return known;

  const { platform, module } = schema;
  const out: SdkSymbol[] = [];

  for (const t of schema.types) {
    out.push(typeSymbol(platform, module, t));
    if (t.kind !== "class") continue;

    for (const c of t.constructors ?? []) out.push(memberSymbol(platform, module, t, c));
    for (const m of t.methods ?? []) out.push(memberSymbol(platform, module, t, m));
    for (const p of t.properties ?? []) out.push(memberSymbol(platform, module, t, p));
  }

  for (const f of schema.functions ?? []) out.push(memberSymbol(platform, module, undefined, f));
  for (const c of schema.constants ?? []) out.push(memberSymbol(platform, module, undefined, c));

  symbolsOf.set(schema, out);
  return out;
}

/** `s` as `schema` (another version of its module) declares it (see matchSymbols). */
export function findSymbol(schema: SdkModuleSchema, s: SdkSymbol): SdkSymbol | undefined {
  return matchSymbols(schema, [s]).get(s);
}

type Pass = (s: SdkSymbol, pool: SdkSymbol[]) => SdkSymbol | undefined;

const sameStatic = (a: SdkSymbol, b: SdkSymbol) => !!a.static === !!b.static;

/** How a symbol is found in another version, most certain first. */
const PASSES: Pass[] = [
  // The same native symbol, else the same name and signature.
  (s, pool) => {
    const same = s.symbol ? pool.filter((c) => c.symbol === s.symbol) : [];
    const named = (c: SdkSymbol) => c.name === s.name;

    return (
      same.find((c) => named(c) && c.signature === s.signature) ??
      same.find(named) ??
      same[0] ??
      pool.find((c) => named(c) && c.signature === s.signature && sameStatic(c, s))
    );
  },

  // The one member left of its name: its signature or symbol changed.
  // Not a constructor: its signature is what tells overloads apart.
  (s, pool) => {
    if (s.kind === "constructor") return undefined;

    const named = pool.filter((c) => c.name === s.name && sameStatic(c, s));
    return named.length === 1 ? named[0] : undefined;
  },
];

/**
 * `symbols` (of one module) as `schema`, another version of it, declares
 * them; each of its symbols answers for one of them at most. A member is
 * looked for under its owner as `schema` has it: the type `symbols` list
 * for it, found again, else the type of its name; under any type when
 * neither says (a renamed owner), and nowhere when its listed type is gone.
 */
function matchSymbols(schema: SdkModuleSchema, symbols: SdkSymbol[]): Map<SdkSymbol, SdkSymbol> {
  const candidates = sdkSymbols(schema);
  const found = new Map<SdkSymbol, SdkSymbol>();
  const taken = new Set<SdkSymbol>();

  const match = (list: SdkSymbol[], scope: (s: SdkSymbol) => SdkSymbol[]) => {
    for (const pass of PASSES)
      for (const s of list) {
        if (found.has(s)) continue;

        const pool = scope(s).filter((c) => c.kind === s.kind && !taken.has(c));
        const hit = pass(s, pool);
        if (!hit) continue;

        found.set(s, hit);
        taken.add(hit);
      }
  };

  const types = symbols.filter((s) => s.kind === "type");
  match(types, () => candidates.filter((c) => c.owner === undefined));

  // A listed type's name in `schema`: null when it is gone.
  const listed = new Map(types.map((t) => [t.name, found.get(t)?.name ?? null]));
  const exists = (name: string) => candidates.some((c) => c.kind === "type" && c.name === name);

  const under = (s: SdkSymbol): SdkSymbol[] => {
    if (s.owner === undefined) return candidates.filter((c) => c.owner === undefined);

    const owner = listed.has(s.owner) ? listed.get(s.owner)! : s.owner;
    if (owner === null) return [];

    return exists(owner) ? candidates.filter((c) => c.owner === owner) : candidates;
  };

  match(
    symbols.filter((s) => s.kind !== "type"),
    under,
  );

  return found;
}

export interface SymbolChange {
  change: "removed" | "changed" | "added" | "unchanged";
  before?: SdkSymbol;
  after?: SdkSymbol;
  /** What changed, in words, for changed symbols; why, for a removed module. */
  details: string[];
}

/** How `after` differs from `before`, in words. */
function differences(before: SdkSymbol, after: SdkSymbol): string[] {
  const out: string[] = [];
  const arrow = (a: unknown, b: unknown) => `${a ?? "-"} → ${b ?? "-"}`;

  if (before.owner !== after.owner) out.push(`declared by: ${arrow(before.owner, after.owner)}`);
  if (before.name !== after.name) out.push(`TypeScript name: ${arrow(before.name, after.name)}`);
  if (!!before.static !== !!after.static)
    out.push(before.static ? "static → instance member" : "instance → static member");
  if (before.signature !== after.signature)
    out.push(`signature: ${arrow(before.signature, after.signature)}`);
  if (before.symbol !== after.symbol)
    out.push(`native symbol: ${nativeArrow(before.symbol, after.symbol)}`);
  if (before.since !== after.since) out.push(`since: ${arrow(before.since, after.since)}`);
  if (!before.deprecated && after.deprecated) out.push("deprecated");
  if (before.deprecated && !after.deprecated) out.push("no longer deprecated");

  const removed = (before.cases ?? []).filter((c) => !after.cases?.includes(c));
  const added = (after.cases ?? []).filter((c) => !before.cases?.includes(c));
  if (removed.length) out.push(`cases removed: ${removed.join(", ")}`);
  if (added.length) out.push(`cases added: ${added.join(", ")}`);

  return out;
}

/** Two native symbols, the owner part they share left out: `level()I → level()J`. */
function nativeArrow(a: SymbolId | undefined, b: SymbolId | undefined): string {
  const owner = (s: string) => s.slice(0, s.indexOf("#") + 1);
  if (a && b && a.includes("#") && owner(a) === owner(b))
    return `${a.slice(owner(a).length)} → ${b.slice(owner(b).length)}`;

  return `${a ?? "-"} → ${b ?? "-"}`;
}

function change(before: SdkSymbol, after: SdkSymbol | undefined): SymbolChange {
  if (!after) return { change: "removed", before, details: [] };

  const details = differences(before, after);
  return { change: details.length ? "changed" : "unchanged", before, after, details };
}

/**
 * What became of `used` in the versions of their modules `schemaOf` gives:
 * every symbol, in order, removed (with why when its module is gone),
 * changed or unchanged.
 */
export function diffSymbols(
  used: SdkSymbol[],
  schemaOf: (platform: Platform, module: string) => SdkModuleSchema | { missing: string },
): SymbolChange[] {
  const byModule = new Map<string, SdkSymbol[]>();
  for (const s of used) {
    const key = `${s.platform}/${s.module}`;
    byModule.set(key, [...(byModule.get(key) ?? []), s]);
  }

  const results = new Map<SdkSymbol, SymbolChange>();
  for (const list of byModule.values()) {
    const schema = schemaOf(list[0]!.platform, list[0]!.module);

    if ("missing" in schema)
      for (const s of list)
        results.set(s, { change: "removed", before: s, details: [schema.missing] });
    else {
      const found = matchSymbols(schema, list);
      for (const s of list) results.set(s, change(s, found.get(s)));
    }
  }

  return used.map((s) => results.get(s)!);
}

/** Every symbol of two versions of a module: removed, changed, unchanged, then added. */
export function diffModule(before: SdkModuleSchema, after: SdkModuleSchema): SymbolChange[] {
  const found = matchSymbols(after, sdkSymbols(before));
  const matched = new Set(found.values());

  const changes = sdkSymbols(before).map((s) => change(s, found.get(s)));
  const added = sdkSymbols(after)
    .filter((s) => !matched.has(s))
    .map((s): SymbolChange => ({ change: "added", after: s, details: [] }));

  return [...changes, ...added];
}

/** A used module whose artifacts are not the ones a lock records (`locked` absent: not recorded). */
export interface ArtifactChange {
  module: string;
  locked?: string[];
  found: string[];
}

/**
 * The modules of `found` whose artifacts differ from `locked`'s, by
 * module. Modules only the lock has are no longer used: not a difference.
 */
export function compareArtifacts(
  locked: Record<string, UsedModule>,
  found: Record<string, UsedModule>,
): ArtifactChange[] {
  const same = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

  return Object.keys(found)
    .sort()
    .flatMap((module): ArtifactChange[] => {
      const now = found[module]!.artifacts;
      const was = locked[module]?.artifacts;

      if (!was) return [{ module, found: now }];
      return same(was, now) ? [] : [{ module, locked: was, found: now }];
    });
}
