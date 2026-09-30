/**
 * The SDK symbols a compile uses: every member a binding plan accepted a
 * use of, with the roles it is used in, and the types of its module the
 * member names. Build tools record them (sdk-usage.json, the SDK lock).
 */
import {
  type BindingPlan,
  memberSymbol,
  type Role,
  type SchemaType,
  symbolKey,
  typeSymbol,
  type UsedSymbol,
} from "@lucent-lang/bindgen";
import {
  loadSdkModule,
  type Platform,
  type SdkCallable,
  type SdkClassSchema,
  type SdkMethodSchema,
  type SdkPropertySchema,
} from "./schema.ts";

let recording: Map<string, UsedSymbol> | undefined;

/** Runs `f`, and lists the SDK symbols the code it compiles uses, sorted by key. */
export function recordSdkUses<T>(f: () => T): { value: T; uses: UsedSymbol[] } {
  const saved = recording;
  const uses = new Map<string, UsedSymbol>();
  recording = uses;

  try {
    const value = f();
    const sorted = [...uses.keys()].sort().map((k) => uses.get(k)!);

    return { value, uses: sorted };
  } finally {
    recording = saved;
  }
}

/** A use of `member` (of `owner`, in `module`) that `plan` accepts. */
export function noteSdkUse(
  platform: Platform,
  module: string,
  owner: SdkClassSchema | undefined,
  member: SdkMethodSchema | SdkPropertySchema | SdkCallable,
  plan: BindingPlan,
): void {
  if (!recording) return;

  add(memberSymbol(platform, module, owner, member), plan.role);

  // The module's own types the member names; other modules' would need
  // their schemas, which a use does not otherwise extract.
  const schema = loadSdkModule(platform, module);
  const named = new Set(owner ? [owner.name] : []);
  for (const value of [plan.receiver, ...plan.inputs, plan.output])
    if (value) refsIn(value.type, module, named);

  for (const t of schema.types) if (named.has(t.name)) add(typeSymbol(platform, module, t));
}

function add(symbol: UsedSymbol, role?: Role): void {
  const key = symbolKey(symbol);
  const known = recording!.get(key) ?? symbol;
  const roles = new Set([...(known.roles ?? []), ...(role ? [role] : [])]);

  recording!.set(key, roles.size ? { ...known, roles: [...roles].sort() } : known);
}

/** The names of `module`'s types that `t` refers to, anywhere inside it. */
function refsIn(t: SchemaType, module: string, into: Set<string>): void {
  if (t.k === "ref" && t.module === module) into.add(t.name);

  for (const v of Object.values(t) as unknown[])
    for (const inner of Array.isArray(v) ? v : [v])
      if (inner && typeof inner === "object" && "k" in inner)
        refsIn(inner as SchemaType, module, into);
}
