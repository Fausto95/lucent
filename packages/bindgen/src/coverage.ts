import { ownTypes, planBinding, type TypeLookup, unsupportedReason } from "./binding-plan.ts";
import type { SchemaProvenance, SdkModuleSchema } from "./schema.ts";
import { displayName, memberSymbol, symbolKey } from "./usage.ts";

/**
 * How far a member gets, each stage needing the one before: declared
 * (`discovered`), with a binding plan that can work (`representable`),
 * in the code an app's build generated (`generated`), and run by a test or
 * probe whose evidence says so (`exercised`).
 */
export type CoverageStage = "discovered" | "representable" | "generated" | "exercised";

export interface CoverageMember {
  /** The member's symbol key (usage.ts); none for a member the extractor skipped. */
  key?: string;
  display: string;
  symbol?: string;
  /** The artifact declaring it. */
  artifact?: string;
  stage: CoverageStage;
  /** Why it is not representable. */
  reason?: string;
}

/** How much of a module Lucent code can call, and how. */
export interface Coverage {
  module: string;
  /** Where the module's declarations come from. */
  provenance?: SchemaProvenance;
  /** Reached through an idiom: a getter read as a property, a completion handler called as a promise. */
  idiomatic: number;
  /** Callable as the platform declares it. */
  raw: number;
  /** Skipped (no Lucent type yet), or declared but refused by its binding plan. */
  unrepresentable: number;
  total: number;
  /** Why members were skipped or refused, with how many. */
  reasons: Record<string, number>;
  /** How many members reach each stage; null when there is no evidence for it. */
  stages: Record<"discovered" | "representable", number> &
    Record<"generated" | "exercised", number | null>;
  members: CoverageMember[];
}

/** What says a member got past representable: symbol keys (usage.ts). */
export interface CoverageEvidence {
  /** The members an app's build generated code for. */
  generated?: ReadonlySet<string>;
  /** The members tests or probes ran. */
  exercised?: ReadonlySet<string>;
}

/**
 * A module's coverage, from its schema and its members' binding plans: a
 * member every use of which its plan refuses counts as unrepresentable,
 * under the plan's reason. `types` gives the facts of the types members
 * name (by default the module's own; other modules' are unknown).
 */
export function coverage(
  schema: SdkModuleSchema,
  types: TypeLookup = ownTypes(schema),
  evidence: CoverageEvidence = {},
): Coverage {
  let idiomatic = 0;
  let raw = 0;
  const reasons: Record<string, number> = {};
  const count = (reason: string) => (reasons[reason] = (reasons[reason] ?? 0) + 1);
  const members: CoverageMember[] = [];
  const artifact = schema.provenance?.artifact;

  const stageOf = (key: string): CoverageStage => {
    if (!evidence.generated?.has(key)) return "representable";
    return evidence.exercised?.has(key) ? "exercised" : "generated";
  };

  const tally = (
    owner: Parameters<typeof planBinding>[0],
    member: Parameters<typeof planBinding>[1],
    idiom: boolean,
  ) => {
    const refused = unsupportedReason(planBinding(owner, member, schema, types));
    const symbol = memberSymbol(schema.platform, schema.module, owner, member);
    const key = symbolKey(symbol);

    if (refused) count(refused);
    else if (idiom) idiomatic++;
    else raw++;

    members.push({
      key,
      display: displayName(symbol),
      ...(symbol.symbol ? { symbol: symbol.symbol } : {}),
      ...(artifact ? { artifact } : {}),
      stage: refused ? "discovered" : stageOf(key),
      ...(refused ? { reason: refused } : {}),
    });
  };

  for (const t of schema.types) {
    if (t.kind !== "class") continue;

    for (const c of t.constructors ?? []) tally(t, c, false);
    for (const m of t.methods ?? []) tally(t, m, !!m.async);
    for (const p of t.properties ?? []) tally(t, p, !!p.getter);
  }
  for (const f of schema.functions ?? []) tally(undefined, f, false);
  for (const c of schema.constants ?? []) tally(undefined, c, false);

  // `Class.member: reason`.
  for (const s of schema.skipped ?? []) {
    const at = s.indexOf(": ");
    const reason = s.slice(at + 2);

    count(reason);
    members.push({ display: s.slice(0, at), stage: "discovered", reason });
  }

  const unrepresentable = Object.values(reasons).reduce((a, b) => a + b, 0);
  const reached = (stage: CoverageStage) => members.filter((m) => m.stage === stage).length;
  const exercised = reached("exercised");

  return {
    module: schema.module,
    ...(schema.provenance ? { provenance: schema.provenance } : {}),
    idiomatic,
    raw,
    unrepresentable,
    total: idiomatic + raw + unrepresentable,
    reasons,
    stages: {
      discovered: members.length,
      representable: idiomatic + raw,
      generated: evidence.generated ? exercised + reached("generated") : null,
      exercised: evidence.generated && evidence.exercised ? exercised : null,
    },
    members,
  };
}
