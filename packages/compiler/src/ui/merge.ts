/**
 * One description per component across targets. Each platform's program
 * describes the components it implements; React sees one component, so
 * their public contracts (props, events, commands) must agree, and a
 * component on one platform must be one on every platform compiled. The
 * host's descriptions (no platform) stand only when no platform was.
 */
import { Codes, type Diagnostic } from "../diagnostics.ts";
import type { Target } from "../platforms.ts";
import type { ComponentDescription } from "./contract.ts";

export interface TargetComponents {
  readonly target: Target;
  readonly components: readonly ComponentDescription[];
}

export interface Merged {
  readonly components: ComponentDescription[];
  readonly diagnostics: Diagnostic[];
}

const CONTRACT = ["props", "events", "commands"] as const;

export function mergeComponents(results: readonly TargetComponents[]): Merged {
  const platforms = results.filter((r) => r.target !== "host");
  const used = platforms.length ? platforms : results;
  const byId = new Map<string, ComponentDescription>();
  const diagnostics: Diagnostic[] = [];

  for (const r of used)
    for (const c of r.components) {
      const first = byId.get(c.id);

      if (!first) {
        byId.set(c.id, c);
        continue;
      }

      const differs = CONTRACT.filter((k) => JSON.stringify(first[k]) !== JSON.stringify(c[k]));

      for (const k of differs)
        diagnostics.push(
          located(
            c,
            `\`${c.export}\` has different ${k} on ${targetOf(first)} and ${r.target}: a component's props, events and commands are the same on every platform`,
          ),
        );

      byId.set(c.id, { ...first, platforms: { ...first.platforms, ...c.platforms } });
    }

  for (const c of byId.values())
    for (const r of used)
      if (!r.components.some((x) => x.id === c.id))
        diagnostics.push(
          located(
            c,
            `\`${c.export}\` is a component on ${targetOf(c)} but not on ${r.target}: return a view on every platform`,
          ),
        );

  return { components: diagnostics.length ? [] : [...byId.values()], diagnostics };
}

/** The first platform a description names. */
function targetOf(c: ComponentDescription): string {
  return Object.keys(c.platforms)[0] ?? "host";
}

function located(c: ComponentDescription, message: string): Diagnostic {
  return {
    code: Codes.ComponentPlatforms,
    message,
    file: c.source.file,
    line: c.source.line,
    column: c.source.column,
  };
}
