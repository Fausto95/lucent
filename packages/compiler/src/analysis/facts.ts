/**
 * What the analyses know about a unit, and why. Every fact carries the
 * first cause found for it: a step in the unit (a read, a call, a native
 * use) that, when it is a call, leads on to the callee's own cause. The
 * chain is the short path a message prints: `run` calls `decode`, which
 * reads module state `cache`.
 */
import path from "node:path";
import type ts from "typescript";
import type { EffectSummary } from "../ir/ir.ts";
import type { Unit } from "./units.ts";

/** One step of why a fact holds; `next` continues in the callee a call step names. */
export interface Cause {
  readonly unit: Unit;
  readonly node: ts.Node;
  /** What the step does, as a verb phrase: "calls `decode`", "reads module state `cache`". */
  readonly text: string;
  readonly next?: Cause;
}

export interface Location {
  file: string;
  line: number;
  column: number;
}

/** A step as messages and tests print it. */
export interface Step {
  /** The unit the step is in. */
  unit: string;
  text: string;
  at: Location;
}

/** A fact that holds for some reason, known or not: e.g. `{ yes: … }` or `{ unknown: … }`. */
export type Levels<K extends string> = Partial<Record<K, Cause>>;

/**
 * A unit's effects, including those of everything it calls (transitively)
 * and of the callbacks it is known to run. Parameters are left open: what
 * a unit does to the objects and functions its caller passes is the
 * caller's to bind (`mutates`, `invokes`, `escapes`, `returns`).
 */
export interface Summary {
  /**
   * Module state it reads, by variable key. `constants`: the module
   * constants it reads that are not state but not literals either, which
   * only the module's thread may read. `unknown`: through code the
   * compiler cannot see.
   */
  readonly reads: {
    readonly vars: ReadonlyMap<string, Cause>;
    readonly constants: ReadonlyMap<string, Cause>;
    readonly unknown?: Cause;
  };
  readonly writes: { readonly vars: ReadonlyMap<string, Cause>; readonly unknown?: Cause };
  /** It mutates an object it did not create: one its caller passed, or reached through one. */
  readonly mutates?: Cause;
  readonly allocates: Levels<"yes" | "unknown">;
  readonly throws: Levels<"yes" | "unknown">;
  /** It suspends itself: `await`, `yield`. */
  readonly suspends?: Cause;
  /** It starts work that continues later on its context (promises, timers, main()). */
  readonly schedules?: Cause;
  /** It calls function values: known ones (closures, native re-entry), or unknown ones. */
  readonly callbacks: Levels<"known" | "unknown">;
  /** The parameters (functions) it calls, its own or an enclosing unit's: the caller knows what it passes. */
  readonly invokes: ReadonlyMap<ts.Symbol, Cause>;
  /** The thread native code it calls needs. */
  readonly affinity: Levels<"main" | "worker" | "unknown">;
  readonly blocking: Levels<"yes" | "unknown">;
  readonly native: Levels<"known" | "unknown">;
  /**
   * What module code the platform calls back while the unit's native calls
   * run does (a callback it keeps, an override of a platform class, a
   * requirement): in the legacy module context its glue enters, holding the
   * Lucent lock, not in the unit's own context. The module state it reads
   * and writes, and `unknown`: state or code the compiler cannot see.
   */
  readonly calledBack: {
    readonly reads: ReadonlyMap<string, Cause>;
    readonly writes: ReadonlyMap<string, Cause>;
    readonly unknown?: Cause;
  };
  /** Parameters whose values may outlive the call: stored, captured by an escaping closure, kept… */
  readonly escapes: ReadonlyMap<number, Cause>;
  /** Parameters whose values it may return. */
  readonly returns: ReadonlyMap<number, Cause>;
}

/** A summary under construction: facts only rise, each keeping the first cause found. */
export class SummaryBuilder implements Summary {
  readonly reads = {
    vars: new Map<string, Cause>(),
    constants: new Map<string, Cause>(),
    unknown: undefined as Cause | undefined,
  };
  readonly writes = { vars: new Map<string, Cause>(), unknown: undefined as Cause | undefined };
  mutates?: Cause;
  readonly allocates: Levels<"yes" | "unknown"> = {};
  readonly throws: Levels<"yes" | "unknown"> = {};
  suspends?: Cause;
  schedules?: Cause;
  readonly callbacks: Levels<"known" | "unknown"> = {};
  readonly invokes = new Map<ts.Symbol, Cause>();
  readonly affinity: Levels<"main" | "worker" | "unknown"> = {};
  readonly blocking: Levels<"yes" | "unknown"> = {};
  readonly native: Levels<"known" | "unknown"> = {};
  readonly calledBack = {
    reads: new Map<string, Cause>(),
    writes: new Map<string, Cause>(),
    unknown: undefined as Cause | undefined,
  };
  readonly escapes = new Map<number, Cause>();
  readonly returns = new Map<number, Cause>();
  /** Whether a fact rose since the last `settle()`. */
  private rose = false;

  /** Sets `levels[key]` unless it is set. */
  level<K extends string>(levels: Levels<K>, key: K, cause: Cause): void {
    if (levels[key]) return;

    levels[key] = cause;
    this.rose = true;
  }

  entry<K>(map: Map<K, Cause>, key: K, cause: Cause): void {
    if (map.has(key)) return;

    map.set(key, cause);
    this.rose = true;
  }

  flag(field: "mutates" | "suspends" | "schedules", cause: Cause): void {
    if (this[field]) return;

    this[field] = cause;
    this.rose = true;
  }

  /** Anything may happen: a call the compiler cannot resolve. */
  anything(cause: Cause): void {
    this.unknownState("reads", cause);
    this.unknownState("writes", cause);
    this.flag("mutates", cause);

    for (const levels of [this.allocates, this.throws, this.blocking] as Levels<
      "yes" | "unknown"
    >[])
      this.level(levels, "unknown", cause);

    this.level(this.callbacks, "unknown", cause);
    this.level(this.native, "unknown", cause);
    this.level(this.affinity, "unknown", cause);
  }

  /** Code called back does what the compiler cannot see. */
  calledBackUnknown(cause: Cause): void {
    if (this.calledBack.unknown) return;

    this.calledBack.unknown = cause;
    this.rose = true;
  }

  unknownState(field: "reads" | "writes", cause: Cause): void {
    if (this[field].unknown) return;

    this[field].unknown = cause;
    this.rose = true;
  }

  /** Whether anything rose since the last call. */
  settle(): boolean {
    const rose = this.rose;

    this.rose = false;
    return rose;
  }
}

/** The same levels, as `EffectSummary` names them. */
const PROJECT = {
  state: (s: Summary["writes"], back: ReadonlyMap<string, Cause>, unknown?: Cause) =>
    s.unknown || unknown ? "unknown" : s.vars.size || back.size ? "module" : "none",
  yesNo: (l: Levels<"yes" | "unknown">) => (l.yes ? "yes" : l.unknown ? "unknown" : "no"),
  known: (l: Levels<"known" | "unknown">) => (l.unknown ? "unknown" : l.known ? "known" : "none"),
} as const;

/**
 * The IR's effect record: `reads`/`writes` of module state, and the rest
 * as known. What code called back does counts: it happens during the
 * unit's calls, whatever context it runs in. Allocation and throwing that may happen are `true`/`yes` even
 * when some part is unknown; a unit needing a thread other than main, or
 * more than one, has an unknown affinity.
 */
export function effectSummary(
  s: Summary,
  own: { async: boolean; generator: boolean },
): EffectSummary {
  const allocates = s.allocates.yes ? true : s.allocates.unknown ? "unknown" : false;
  const affinity =
    s.affinity.worker || s.affinity.unknown ? "unknown" : s.affinity.main ? "main" : "any";

  const back = s.calledBack;
  const callbacks = back.unknown
    ? "unknown"
    : s.invokes.size && !s.callbacks.unknown
      ? "known"
      : PROJECT.known(s.callbacks);

  return {
    reads: PROJECT.state(s.reads, back.reads, back.unknown),
    writes: PROJECT.state(s.writes, back.writes, back.unknown),
    allocates,
    throws: PROJECT.yesNo(s.throws),
    suspends: own.async || own.generator,
    callbacks,
    affinity,
    native: PROJECT.known(s.native),
  };
}

function locationOf(node: ts.Node): Location {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));

  return { file: path.basename(sf.fileName), line: line + 1, column: character + 1 };
}

function formatLocation(at: Location): string {
  return `${at.file}:${at.line}:${at.column}`;
}

/** The chain of steps from `cause` on. */
export function stepsOf(cause: Cause): Step[] {
  const out: Step[] = [];

  for (let c: Cause | undefined = cause; c; c = c.next)
    out.push({ unit: c.unit.display, text: c.text, at: locationOf(c.node) });

  return out;
}

/** "calls `decode` (m.lucent.ts:4:3), which reads module state `cache` (m.lucent.ts:9:10)". */
export function describe(cause: Cause): string {
  return stepsOf(cause)
    .map((s) => `${s.text} (${formatLocation(s.at)})`)
    .join(", which ");
}

/** A step at `node` in `unit` that continues with `next`. */
export function step(unit: Unit, node: ts.Node, text: string, next?: Cause): Cause {
  return next ? { unit, node, text, next } : { unit, node, text };
}

/** `name` in backquotes, as messages quote code. */
export function code(name: string): string {
  return `\`${name}\``;
}
