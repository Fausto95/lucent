import type { SdkModuleSchema } from "./schema.ts";

/** How much of a module Lucent code can call, and how. */
export interface Coverage {
  module: string;
  /** Reached through an idiom: a getter read as a property, a completion handler called as a promise. */
  idiomatic: number;
  /** Callable as the platform declares it. */
  raw: number;
  /** Skipped: no Lucent type yet. */
  unrepresentable: number;
  total: number;
  /** Why members were skipped, with how many. */
  reasons: Record<string, number>;
}

/** A module's coverage, from its schema. */
export function coverage(schema: SdkModuleSchema): Coverage {
  let idiomatic = 0;
  let raw = 0;
  for (const t of schema.types) {
    if (t.kind !== "class") continue;
    raw += t.constructors?.length ?? 0;
    for (const m of t.methods ?? []) m.async ? idiomatic++ : raw++;
    for (const p of t.properties ?? []) p.getter ? idiomatic++ : raw++;
  }
  raw += (schema.functions?.length ?? 0) + (schema.constants?.length ?? 0);
  const reasons: Record<string, number> = {};
  for (const s of schema.skipped ?? []) {
    const reason = s.slice(s.indexOf(": ") + 2);
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const unrepresentable = schema.skipped?.length ?? 0;
  return {
    module: schema.module,
    idiomatic,
    raw,
    unrepresentable,
    total: idiomatic + raw + unrepresentable,
    reasons,
  };
}
