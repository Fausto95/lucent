// ES2024's library: grouping into a record or a map, promises with their
// settling functions, and well-formed strings.
import { delay } from "lucent:core";

/**
 * Object.groupBy makes a record of arrays, keyed in JavaScript's order. Its
 * key function returns `string`: literal keys would type the result as an
 * object type, which Lucent refuses here.
 */
export function groupedRecord(): string {
  const words = ["apple", "avocado", "banana", "blueberry", "cherry"];
  const byLetter = Object.groupBy(words, (w) => w[0] ?? "");
  // Integer-like keys come first, ascending, as an object's own keys do.
  const mixed = Object.groupBy(["b", "10", "a", "2", "b"], (k): string => k);
  const byIndex = Object.groupBy(words, (_, i): string => (i % 2 === 0 ? "even" : "odd"));
  return [
    JSON.stringify(byLetter),
    Object.keys(mixed).join(","),
    JSON.stringify(byIndex),
    byLetter["b"]?.length,
    byLetter["z"] === undefined,
  ].join(" ");
}

/** Map.groupBy keys by SameValueZero: -0 is 0, NaN is itself, objects by identity. */
export function groupedMap(): string {
  const thirds = Map.groupBy([1, 2, 3, 4, 5, 6], (n) => n % 3);
  const lines: string[] = [];
  for (const [k, v] of thirds) lines.push(`${k}:${v.join(",")}`);
  const zeros = Map.groupBy([0, -0, Number.NaN, 1, Number.NaN], (n) => n);
  const negativeZero = [...zeros.keys()].some((k) => 1 / k === -Infinity);
  const a = { name: "a" };
  const b = { name: "b" };
  const owners = Map.groupBy([a, b, a], (o) => o);
  return [
    lines.join(" "),
    zeros.size,
    [...zeros.keys()].join(","),
    negativeZero,
    owners.get(a)?.length,
    owners.get({ name: "a" }) === undefined,
  ].join(" ");
}

function* letters(): Generator<string> {
  yield "x";
  yield "y";
  yield "x";
}

/** Both read any iterable: a set, a string by code point, a generator. */
export function groupedIterables(): string {
  const parity = Object.groupBy(new Set([1, 2, 3, 3]), (n): string => (n % 2 ? "odd" : "even"));
  const ls = Map.groupBy("hello😀", (c) => c === "l");
  const fromGenerator = Object.groupBy(letters(), (l) => l);
  return [
    JSON.stringify(parity),
    `${ls.get(true)?.join("")}/${ls.get(false)?.join("")}`,
    JSON.stringify(fromGenerator),
  ].join(" ");
}

/** A key function that throws stops the grouping, and the error reaches the caller. */
export function groupingThrows(): string {
  try {
    Object.groupBy([1, 2, 3], (n): string => {
      if (n === 2) throw new RangeError(`no ${n}`);
      return "k";
    });
    return "grouped";
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
}

/** Promise.withResolvers: a promise and the functions that settle it, once. */
export async function resolvers(): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<number>();
  const later = async () => {
    await delay(1);
    resolve(21);
  };
  void later();
  const value = await promise;

  const r = Promise.withResolvers<string>();
  r.reject(new RangeError("no"));
  r.resolve("late");
  let caught = "";
  try {
    await r.promise;
  } catch (e) {
    caught = (e as Error).name;
  }

  const nothing = Promise.withResolvers<void>();
  nothing.resolve();
  await nothing.promise;

  const first = Promise.withResolvers<string>();
  first.resolve("first");
  first.resolve("second");
  return `${value * 2} ${caught} ${await first.promise}`;
}

/** isWellFormed finds a lone surrogate; toWellFormed replaces each with U+FFFD. */
export function wellFormed(): string {
  const samples = ["abc", "é", "😀", "\uD83D", "a\uDE00b", "\uDE00\uD83D", "x😀y", ""];
  return samples
    .map((s) => {
      const fixed = [...s.toWellFormed()].map((c) => c.codePointAt(0)?.toString(16)).join("-");
      return `${s.isWellFormed()}:${fixed}`;
    })
    .join(" ");
}
