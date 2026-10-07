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
  /**
   * Members left out of the counts: Swift's Hashable, Equatable and
   * Codable plumbing (`hash(into:)`, `==`, `encode(to:)`, `init(from:)`,
   * `hashValue`), which Swift calls and Lucent code has no use for.
   */
  plumbing: number;
  /** The SDK the schema was read from (`sdk:iphonesimulator27.0`, `android-sdk:36`), when known. */
  sdk?: string;
  /** How many members reach each stage; null when there is no evidence for it. */
  stages: Record<"discovered" | "representable", number> &
    Record<"generated" | "exercised", number | null>;
  members: CoverageMember[];
}

/**
 * Swift's protocol plumbing, by a member's Swift name: what Hashable,
 * Equatable, Comparable and Codable require, which Swift calls itself.
 */
const PLUMBING = /^(hash\(into:\)|hashValue|==\(_:_:\)|!=\(_:_:\)|<\(_:_:\)|encode\(to:\)|init\(from:\))$/;

/**
 * Whether a member is plumbing: its Swift name, or the `Owner.name(…)` a
 * skipped one is listed as (the owner's path is dotted; the name's
 * arguments may hold dots too).
 */
export function isPlumbing(name: string | undefined): boolean {
  if (!name) return false;
  const paren = name.indexOf("(");
  const head = paren < 0 ? name : name.slice(0, paren);
  return PLUMBING.test(name.slice(head.lastIndexOf(".") + 1));
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
  let plumbing = 0;
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
    if (isPlumbing((member as { swift?: { name: string } }).swift?.name)) {
      plumbing++;
      return;
    }
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
    if (isPlumbing(s.slice(0, at))) {
      plumbing++;
      continue;
    }

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
    plumbing,
    ...(sdkOf(schema) ? { sdk: sdkOf(schema)! } : {}),
    stages: {
      discovered: members.length,
      representable: idiomatic + raw,
      generated: evidence.generated ? exercised + reached("generated") : null,
      exercised: evidence.generated && evidence.exercised ? exercised : null,
    },
    members,
  };
}

/** The SDK a schema was read from: its own artifact when it is the SDK, else its target. */
function sdkOf(schema: SdkModuleSchema): string | undefined {
  const p = schema.provenance;
  if (!p) return undefined;
  if (p.artifact.startsWith("sdk:") || p.artifact.startsWith("android-sdk:")) return p.artifact;
  return p.target || undefined;
}

/**
 * A markdown summary of `reports` (CI's step summary): their members in
 * total, and the `top` reasons members are unrepresentable, summed across
 * modules, most first (ties by reason, so each run gives the same text);
 * then the modules that could not be read, and why.
 */
export function coverageSummary(
  reports: readonly Coverage[],
  top = 20,
  unread: readonly { module: string; reason: string }[] = [],
): string {
  const total = reports.reduce((n, c) => n + c.total, 0);
  const unrepresentable = reports.reduce((n, c) => n + c.unrepresentable, 0);
  const pct = (n: number) => `${total ? ((100 * n) / total).toFixed(1) : "0.0"}%`;

  const reasons = new Map<string, number>();
  for (const c of reports)
    for (const [reason, n] of Object.entries(c.reasons))
      reasons.set(reason, (reasons.get(reason) ?? 0) + n);

  const ranked = [...reasons]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, top);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const modules = `${reports.length} module${reports.length === 1 ? "" : "s"}`;

  return [
    "## SDK coverage",
    "",
    `${modules}: ${total} members, ${total - unrepresentable} representable (${pct(total - unrepresentable)}), ${unrepresentable} unrepresentable (${pct(unrepresentable)}).`,
    "",
    `| Members | Why they are unrepresentable (top ${ranked.length} of ${reasons.size}) |`,
    "| ---: | --- |",
    ...ranked.map(([reason, n]) => `| ${n} | ${cell(reason)} |`),
    "",
    ...(unread.length
      ? [
          `${unread.length} module${unread.length === 1 ? "" : "s"} could not be read:`,
          "",
          ...unread.map((u) => `- ${u.module}: ${u.reason.split("\n")[0]!.replace(/:$/, "")}`),
          "",
        ]
      : []),
  ].join("\n");
}
