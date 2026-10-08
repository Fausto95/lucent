/**
 * Methods of a Lucent class implementing SDK protocols that look like a
 * requirement but match none: a typo in an optional requirement's name
 * compiles (TypeScript checks only the required ones) and the platform
 * never calls it, so Lucent warns, as `noImplicitOverride` does for
 * overrides.
 */
import ts from "typescript";
import { Codes } from "../diagnostics.ts";
import { sdkInterfacesOf } from "../sdk/declarations.ts";
import type { ClassInfo } from "../types.ts";
import type { Ctx } from "./context.ts";

/** Edit distance, for the requirement a name was likely meant to be. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** The first word of a requirement's name (`locationManager` of `locationManager_didFail…`). */
const head = (name: string) => name.split("_")[0]!;

/**
 * The requirement `name` was most likely meant to be: one at most a few
 * edits away, or sharing its first word (Objective-C delegate methods all
 * start with the delegating object's name) where `name` has the same
 * shape. Undefined when it looks like a method of the class's own.
 */
function meant(name: string, requirements: string[]): string | undefined {
  let best: { r: string; d: number } | undefined;
  for (const r of requirements) {
    const d = distance(name.toLowerCase(), r.toLowerCase());
    if (d <= Math.max(2, Math.floor(r.length / 6)) && (!best || d < best.d)) best = { r, d };
  }
  if (best) return best.r;
  if (!name.includes("_")) return undefined;

  const same = requirements.filter((r) => r.includes("_") && head(r) === head(name));
  return same.sort((a, b) => distance(name, a) - distance(name, b))[0];
}

/** Warns of each method of `info` that matches no requirement of its SDK protocols but looks like one. */
export function checkRequirementNames(ctx: Ctx, info: ClassInfo): void {
  const protocols = sdkInterfacesOf(ctx.checker, info.decl);
  if (!protocols.length) return;

  const requirements = protocols.flatMap((p) => [
    ...(p.cls.methods ?? []).filter((m) => !m.static).map((m) => m.name),
    ...(p.cls.properties ?? []).filter((m) => !m.static).map((m) => m.name),
  ]);
  const known = new Set(requirements);

  // What the class's other supertypes declare: its superclass's and TypeScript interfaces' members.
  const type = ctx.checker.getTypeAtLocation(info.decl);
  for (const base of type.getBaseTypes?.() ?? [])
    for (const p of base.getProperties()) known.add(p.name);
  for (const h of info.decl.heritageClauses ?? [])
    for (const t of h.types)
      for (const p of ctx.checker.getTypeAtLocation(t).getProperties()) known.add(p.name);

  for (const m of info.decl.members) {
    if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name)) continue;
    const mods = ts.getCombinedModifierFlags(m);
    if (mods & (ts.ModifierFlags.Static | ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
      continue;
    const name = m.name.text;
    if (known.has(name)) continue;

    const likely = meant(name, requirements);
    if (!likely) continue;
    const owner = protocols.find(
      (p) =>
        p.cls.methods?.some((x) => x.name === likely) ||
        p.cls.properties?.some((x) => x.name === likely),
    )!;
    ctx.warn(
      m.name,
      Codes.UnmatchedRequirement,
      `${info.decl.name?.text ?? "class"}.${name} matches no requirement of ${owner.cls.name}, so the platform never calls it: did you mean ${likely}?`,
    );
  }
}
