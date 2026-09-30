/**
 * Native facts: what metadata proves about a declaration, each fact with
 * its evidence. The schema's older thread flags (mainActor, worker) are
 * derived here from the same facts, so the two cannot disagree.
 */
import type { FactEvidence, NativeFacts } from "./schema.ts";

/** Nothing proven: what absent facts mean. */
export const UNKNOWN_FACTS: NativeFacts = {
  affinity: "unknown",
  blocking: "unknown",
  ownership: "unknown",
  evidence: [],
};

/** Where an annotation or attribute on a declaration says its code runs. */
export interface ThreadMark {
  affinity: "main" | "worker" | "any";
  source: FactEvidence["source"];
  /** The annotation or attribute as written: `@WorkerThread`, `@MainActor`. */
  detail: string;
}

/**
 * The facts a thread mark proves: where the code runs, and only that. A
 * worker-thread annotation is no proof that it blocks, nor a main-thread
 * one that it is fast.
 */
export function threadFacts(mark: ThreadMark): NativeFacts {
  return {
    affinity: mark.affinity,
    blocking: "unknown",
    ownership: "unknown",
    evidence: [{ fact: "affinity", source: mark.source, detail: mark.detail }],
  };
}

/** The facts that hold for a member: its own, else its class's, else nothing proven. */
export function memberFacts(
  cls: { facts?: NativeFacts } | undefined,
  member: { facts?: NativeFacts },
): NativeFacts {
  return member.facts ?? cls?.facts ?? UNKNOWN_FACTS;
}

/** A class's mainActor flag, from its facts. */
export function classThreadFlags(facts: NativeFacts | undefined): { mainActor?: true } {
  return facts?.affinity === "main" ? { mainActor: true } : {};
}

/**
 * A member's mainActor and worker flags, from its own facts and its
 * class's. A class's mainActor covers its members, so a member says only
 * how it differs: main-only in a class that is not, or (false) any thread
 * in a main-only class. `worker` marks worker affinity, its own or its
 * class's; a worker member of a main-only class overrides the class, as
 * Android's annotations do, so it is not main-only.
 */
export function memberThreadFlags(
  cls: NativeFacts | undefined,
  own: NativeFacts | undefined,
): { mainActor?: boolean; worker?: true } {
  const classMain = cls?.affinity === "main";
  const affinity = (own ?? cls)?.affinity;

  return {
    ...(affinity === "main" && !classMain ? { mainActor: true } : {}),
    ...((affinity === "any" || affinity === "worker") && classMain ? { mainActor: false } : {}),
    ...(affinity === "worker" ? { worker: true } : {}),
  };
}
