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
import {
  type CompileContext,
  compileContext,
  currentCompile,
  runInCompile,
} from "../compile-context.ts";

/** Runs `f`, and lists the SDK symbols the code it compiles uses, sorted by key. */
export function recordSdkUses<T>(f: () => T): { value: T; uses: UsedSymbol[] } {
  const context = compileContext();
  const value = runInCompile(context, f);

  return { value, uses: sdkUsesOf(context) };
}

/** The SDK symbols a compile used, sorted by key. */
export function sdkUsesOf(context: CompileContext): UsedSymbol[] {
  return [...context.sdkUses.keys()].sort().map((k) => context.sdkUses.get(k)!);
}

/** A use of `member` (of `owner`, in `module`) that `plan` accepts. */
export function noteSdkUse(
  platform: Platform,
  module: string,
  owner: SdkClassSchema | undefined,
  member: SdkMethodSchema | SdkPropertySchema | SdkCallable,
  plan: BindingPlan,
): void {
  const uses = currentCompile()?.sdkUses;

  if (!uses) return;

  const add = (symbol: UsedSymbol, role?: Role) => addUse(uses, symbol, role);

  add(memberSymbol(platform, module, owner, member), plan.role);

  // The module's own types the member names; other modules' would need
  // their schemas, which a use does not otherwise extract.
  const schema = loadSdkModule(platform, module);
  const named = new Set(owner ? [owner.name] : []);
  for (const value of [plan.receiver, ...plan.inputs, plan.output])
    if (value) refsIn(value.type, module, named);

  for (const t of schema.types) if (named.has(t.name)) add(typeSymbol(platform, module, t));
}

function addUse(uses: Map<string, UsedSymbol>, symbol: UsedSymbol, role?: Role): void {
  const key = symbolKey(symbol);
  const known = uses.get(key) ?? symbol;
  const roles = new Set([...(known.roles ?? []), ...(role ? [role] : [])]);

  uses.set(key, roles.size ? { ...known, roles: [...roles].sort() } : known);
}

/** The names of `module`'s types that `t` refers to, anywhere inside it. */
function refsIn(t: SchemaType, module: string, into: Set<string>): void {
  if (t.k === "ref" && t.module === module) into.add(t.name);

  for (const v of Object.values(t) as unknown[])
    for (const inner of Array.isArray(v) ? v : [v])
      if (inner && typeof inner === "object" && "k" in inner)
        refsIn(inner as SchemaType, module, into);
}
