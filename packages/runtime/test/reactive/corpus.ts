/**
 * Writes the reactive graph's differential corpus: scripted scenarios for
 * each rule, and seeded random ones, each with the log the reference
 * (reference.ts) gives. run.sh writes it to TMPDIR and reactive_test.cpp
 * runs every scenario against the runtime and compares the logs line by line.
 *
 *   node packages/runtime/test/reactive/corpus.ts <out-file> [random-count]
 *
 * Format: `scenario NAME`, its steps (scenario.ts), `expect`, the log, `end`.
 */
import fs from "node:fs";
import { runScenario } from "./scenario.ts";

/** Scenarios for each rule, by what they show. */
export const scripted: Record<string, string[]> = {
  "a transaction commits a pair at once": [
    "signal min 0",
    "signal max 10",
    "mount m",
    "effect pair m [ if min 1 [ add 0 ] [ add 100 ] read min read max ]",
    "begin",
    "write min 20",
    "write max 30",
    "commit",
    "write min 25",
    "write max 35",
  ],
  "a diamond runs its effect once per change, consistent": [
    "signal s 1",
    "computed left [ read s add 1 ]",
    "computed right [ read s add 2 ]",
    "mount m",
    "effect sum m [ read left read right ]",
    "write s 5",
    "write s 5",
  ],
  "what a run no longer reads stops notifying it": [
    "signal flag 0",
    "signal a 1",
    "signal b 2",
    "mount m",
    "effect pick m [ if flag 1 [ read a ] [ read b ] ]",
    "write b 3",
    "write a 4",
    "write flag 1",
    "write a 5",
    "write b 6",
  ],
  "equality is Object.is": [
    "signal n NaN",
    "signal z 0",
    "mount m",
    "effect nan m [ read n ]",
    "effect zero m [ read z ]",
    "write n NaN",
    "write z -0",
    "write z -0",
    "write z 0",
    "write n 1",
  ],
  "an unchanged computed value stops there": [
    "signal s 1",
    "computed small [ if s 5 [ add 1 ] [ add 2 ] ]",
    "mount m",
    "effect show m [ read small ]",
    "write s 2",
    "write s 7",
    "write s 9",
  ],
  "a rerun disposes the last run first: tasks, then cleanups and nested effects in reverse": [
    "signal s 0",
    "signal inner 0",
    "mount m",
    "effect outer m [ read s cleanup first task job [ ] effect nested [ read inner cleanup n ] cleanup last ]",
    "write inner 1",
    "write s 1",
    "unmount m",
    "write s 2",
    "write inner 2",
  ],
  "an effect that feeds itself is stopped and reported": [
    "signal s 0",
    "mount m",
    "effect grow m [ read s write s 1 ]",
    "read s",
    "write s 100",
  ],
  "two effects that feed each other are reported as a cycle": [
    "signal a 0",
    "signal b 0",
    "mount m",
    "effect ping m [ read a write b 1 ]",
    "effect pong m [ read b write a 1 ]",
    "write a 50",
  ],
  "an unmounted view's effects never run again": [
    "signal s 0",
    "mount m",
    "mount keep",
    "effect gone m [ read s cleanup bye ]",
    "effect stays keep [ read s ]",
    "cleanup m done",
    "write s 1",
    "unmount m",
    "unmount m",
    "write s 2",
  ],
  "a rerun supersedes the task it started; its continuation tracks nothing": [
    "signal s 0",
    "signal other 5",
    "mount m",
    "effect load m [ read s task fetch [ read other ] ]",
    "write s 1",
    "complete fetch",
    "write other 6",
    "write s 2",
    "unmount m",
    "complete fetch",
  ],
  "cleanup errors are reported together, and do not stop the rerun": [
    "signal s 0",
    "mount m",
    "effect fragile m [ read s cleanupthrow one cleanup two cleanupthrow three ]",
    "write s 1",
    "unmount m",
  ],
  "cleanups read without subscribing": [
    "signal s 0",
    "signal t 7",
    "mount m",
    "effect look m [ read s cleanupread t ]",
    "write s 1",
    "write t 8",
    "write s 2",
  ],
  "a computed error is kept until a source changes": [
    "signal s 0",
    "computed risky [ if s 1 [ throw bad ] [ read s ] ]",
    "read risky",
    "read risky",
    "write s 3",
    "read risky",
    "write s 0",
    "read risky",
  ],
  "an effect that throws keeps what it read": [
    "signal s 0",
    "mount m",
    "effect thrower m [ read s if s 1 [ throw first ] [ add 0 ] ]",
    "write s 2",
    "write s 0",
  ],
  "a computed value cannot write": [
    "signal s 0",
    "computed writer [ read s set s 5 ]",
    "read writer",
    "read s",
  ],
  "an effect made in a transaction sees its writes": [
    "signal s 0",
    "mount m",
    "begin",
    "write s 3",
    "effect early m [ read s ]",
    "write s 4",
    "commit",
  ],
  "writes in a cleanup wait for the rerun, and trigger what reads them": [
    "signal s 0",
    "signal echo 0",
    "mount m",
    "effect writer m [ read s cleanupset echo 9 ]",
    "effect reader m [ read echo ]",
    "write s 1",
  ],
  "pending effects run in the order they were made": [
    "signal s 0",
    "signal t 0",
    "mount m",
    "effect x m [ read t ]",
    "effect y m [ read s ]",
    "effect z m [ read s write t 5 ]",
    "write s 1",
  ],
  "a wide run replaces what it read": [
    ...Array.from({ length: 12 }, (_, i) => `signal w${i} ${i}`),
    "mount m",
    `effect wide m [ if w0 1 [ ${Array.from({ length: 11 }, (_, i) => `read w${i + 1}`).join(" ")} ] [ read w11 read w10 ] ]`,
    "write w5 50",
    "write w0 7",
    "write w5 51",
    "write w11 110",
    "write w0 0",
    "write w1 10",
  ],
  "a disposed effect is gone, its mount's others stay": [
    "signal s 0",
    "mount m",
    "effect a m [ read s cleanup a ]",
    "effect b m [ read s cleanup b ]",
    "dispose a",
    "write s 1",
    "dispose a",
    "unmount m",
  ],
};

// mulberry32: small, seeded, the same everywhere (corpus() starts it over).
const SEED = 0x7eac7105;
let seed = SEED;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
const chance = (p: number) => random() < p;
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

const VALUES = ["0", "1", "2", "3", "-0", "NaN", "1", "2"];

/** A random scenario: a few signals, computed values over them, effects, then changes. */
function randomScenario(): string[] {
  const lines: string[] = [];
  const signals: string[] = [];
  const readable: string[] = [];
  const tasks: string[] = [];
  const effects: string[] = [];
  let names = 0;

  // Now and then wide: more sources than a run's short list holds.
  const wide = chance(0.2);

  for (let i = 0, n = wide ? between(9, 14) : between(2, 4); i < n; i++) {
    const id = `s${i}`;
    lines.push(`signal ${id} ${pick(VALUES)}`);
    signals.push(id);
    readable.push(id);
  }

  const reads = (from: string[], max: number) =>
    Array.from({ length: between(1, max) }, () => `read ${pick(from)}`).join(" ");

  const conditional = (from: string[], inner: () => string) =>
    `if ${pick(from)} ${between(1, 3)} [ ${inner()} ] [ ${inner()} ]`;

  for (let i = 0, n = between(0, 3); i < n; i++) {
    const id = `c${i}`;
    const from = [...readable];
    const parts = [reads(from, 2)];
    if (chance(0.5))
      parts.push(conditional(from, () => (chance(0.1) ? "throw oops" : reads(from, 2))));
    if (chance(0.3)) parts.push(`add ${between(0, 2)}`);
    lines.push(`computed ${id} [ ${parts.join(" ")} ]`);
    readable.push(id);
  }

  const mounts = chance(0.5) ? ["m0", "m1"] : ["m0"];
  for (const m of mounts) lines.push(`mount ${m}`);

  const effectBody = (depth: number): string => {
    const parts = [reads(readable, wide ? 16 : 3)];
    if (chance(0.4)) parts.push(conditional(readable, () => reads(readable, 2)));
    if (chance(0.5)) parts.push(`cleanup k${names++}`);
    if (chance(0.1)) parts.push(`cleanupthrow x${names++}`);
    if (chance(0.06)) parts.push(`cleanupset ${pick(signals)} ${pick(VALUES)}`);
    if (chance(0.1)) parts.push(`cleanupread ${pick(readable)}`);
    if (chance(0.08)) parts.push(`write ${pick(signals)} ${between(0, 1)}`);
    if (chance(0.05)) parts.push("throw fail");
    if (chance(0.2)) {
      const t = `t${names++}`;
      tasks.push(t);
      parts.push(
        `task ${t} [ ${reads(readable, 1)} ${chance(0.3) ? `set ${pick(signals)} 2` : ""} ]`,
      );
    }
    if (depth === 0 && chance(0.3)) parts.push(`effect n${names++} [ ${effectBody(1)} ]`);

    // Shuffled: cleanups, tasks and nested effects in any order around the reads.
    for (let i = parts.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [parts[i], parts[j]] = [parts[j]!, parts[i]!];
    }

    return parts.join(" ");
  };

  const effect = () => {
    const id = `e${names++}`;
    effects.push(id);
    lines.push(`effect ${id} ${pick(mounts)} [ ${effectBody(0)} ]`);
  };

  for (let i = 0, n = between(1, 4); i < n; i++) effect();
  if (chance(0.3)) lines.push(`cleanup ${pick(mounts)} m${names++}`);

  const write = () => `write ${pick(signals)} ${pick(VALUES)}`;

  for (let i = 0, n = between(6, 20); i < n; i++) {
    const r = random();

    if (r < 0.45) lines.push(write());
    else if (r < 0.6)
      lines.push("begin", write(), write(), ...(chance(0.5) ? [write()] : []), "commit");
    else if (r < 0.7) lines.push(`read ${pick(readable)}`);
    else if (r < 0.78 && tasks.length > 0) lines.push(`complete ${pick(tasks)}`);
    else if (r < 0.84 && effects.length > 0) lines.push(`dispose ${pick(effects)}`);
    else if (r < 0.9) effect();
    else if (r < 0.93) lines.push(`unmount ${pick(mounts)}`);
    else lines.push(write());
  }

  return lines;
}

/** The corpus text: every scenario with the reference's log. */
export function corpus(randomCount: number): string {
  seed = SEED;
  const all: [string, string[]][] = Object.entries(scripted);
  for (let i = 0; i < randomCount; i++) all.push([`random ${i}`, randomScenario()]);

  return all
    .map(([name, lines]) =>
      [`scenario ${name}`, ...lines, "expect", ...runScenario(lines), "end"].join("\n"),
    )
    .join("\n")
    .concat("\n");
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: corpus.ts <out-file> [random-count]");

  fs.writeFileSync(out, corpus(Number(process.argv[3] ?? 400)));
}
