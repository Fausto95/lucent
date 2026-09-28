import type { SdkModuleSchema } from "../src/schema.ts";

/** Every native symbol a schema records: its types', their members', and its functions' and constants'. */
export function schemaSymbols(schema: SdkModuleSchema): string[] {
  const out: (string | undefined)[] = [];

  for (const t of schema.types) {
    out.push(t.symbol);
    if (t.kind !== "class") continue;

    for (const m of [...(t.constructors ?? []), ...(t.methods ?? []), ...(t.properties ?? [])])
      out.push(m.symbol);
  }

  for (const m of [...(schema.functions ?? []), ...(schema.constants ?? [])]) out.push(m.symbol);

  return out.filter((s): s is string => s !== undefined);
}

/** A symbol's native identifier: the USR, or the JVM name, after its scheme. */
export const nativeId = (symbol: string) => symbol.slice(symbol.indexOf(":") + 1);
