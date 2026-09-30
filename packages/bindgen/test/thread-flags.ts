import { classThreadFlags, memberThreadFlags } from "../src/facts.ts";
import type { SdkModuleSchema } from "../src/schema.ts";

/** The classes and members whose thread flags are not the ones their facts give. */
export function flagsNotFromFacts(modules: SdkModuleSchema[]): string[] {
  const flags = (x: { mainActor?: boolean; worker?: boolean }) =>
    JSON.stringify({
      ...(x.mainActor !== undefined ? { mainActor: x.mainActor } : {}),
      ...(x.worker ? { worker: x.worker } : {}),
    });
  const out: string[] = [];

  for (const t of modules.flatMap((m) => m.types)) {
    if (t.kind !== "class") continue;

    if (flags(t) !== JSON.stringify(classThreadFlags(t.facts))) out.push(t.name);
    for (const m of [...(t.methods ?? []), ...(t.properties ?? [])])
      if (flags(m) !== JSON.stringify(memberThreadFlags(t.facts, m.facts)))
        out.push(`${t.name}.${m.name}`);
  }

  return out;
}
