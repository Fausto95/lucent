// bigint values: in collections, objects, classes, unions, across the
// JavaScript boundary, in closures and in async functions.
import { delay } from "lucent:core";

export const BIG = 2n ** 100n;
export const LIMITS = { min: -(2n ** 63n), max: 2n ** 63n - 1n };

/** Map and Set keys compare by value (SameValueZero), however the value was made. */
export function keys(xs: bigint[]): string {
  const counts = new Map<bigint, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);

  const seen = new Set<bigint>(xs);
  const probes = [1n << 64n, 2n ** 64n, 18446744073709551616n, -0n, 0n, 3n];

  return [
    Array.from(counts, ([k, n]) => `${k}:${n}`).join(" "),
    seen.size,
    probes.map((p) => `${seen.has(p)}/${counts.get(p) ?? "-"}`).join(" "),
  ].join(" | ");
}

export function sorted(xs: bigint[]): bigint[] {
  return [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The default sort compares the decimal strings. */
export function defaultSorted(xs: bigint[]): bigint[] {
  return [...xs].sort();
}

export function search(xs: bigint[], x: bigint): string {
  return `${xs.includes(x)} ${xs.indexOf(x)} ${xs.lastIndexOf(x)} ${xs.findIndex((y) => y > x)} ${xs.join("/")}`;
}

export function sum(xs: readonly bigint[]): bigint {
  return xs.reduce((a, b) => a + b, 0n);
}

export function totals(m: Map<bigint, bigint[]>): Map<bigint, bigint> {
  const out = new Map<bigint, bigint>();
  for (const [k, vs] of m) out.set(-k, sum(vs));

  return out;
}

export function unique(s: Set<bigint>): bigint[] {
  return [...s].map((x) => x * x);
}

export type Ledger = { id: bigint; label: string; limit?: bigint };

export function describe(l: Ledger): string {
  return `${l.label}#${l.id} limit ${l.limit ?? "none"} ${l.limit === undefined}`;
}

export function ledger(id: bigint, withLimit: boolean): Ledger {
  const l: Ledger = { id, label: "L" };
  if (withLimit) l.limit = id * 1000n;

  return l;
}

export function maybe(x: bigint | undefined): bigint | undefined {
  return x === undefined ? undefined : x + 1n;
}

export function orZero(x?: bigint): bigint {
  return x ?? 0n;
}

export function either(x: bigint | string): string {
  if (typeof x === "bigint") return `bigint ${x + 1n}`;

  return `string ${x}`;
}

export function pick(big: boolean): bigint | string {
  return big ? 2n ** 65n : "small";
}

export function mixed(xs: (bigint | number)[]): string {
  return xs.map((x) => (typeof x === "bigint" ? `${x}n` : `${x}`)).join(" ");
}

export class Account {
  balance = 0n;
  readonly history: bigint[] = [];

  constructor(readonly id: bigint) {}

  deposit(amount: bigint): bigint {
    this.balance += amount;
    this.history.push(amount);

    return this.balance;
  }

  get doubled(): bigint {
    return this.balance * 2n;
  }
}

export function openAccount(id: bigint): Account {
  const a = new Account(id);
  a.deposit(id);

  return a;
}

export function applyTwice(f: (x: bigint) => bigint, x: bigint): bigint {
  return f(f(x));
}

export function each(xs: bigint[], f: (x: bigint, i: number) => void): void {
  xs.forEach(f);
}

/** A closure sharing its variable with the function that made it. */
export function counter(start: bigint): () => bigint {
  let n = start;
  const step = (): bigint => (n *= 3n);

  step();
  return step;
}

export async function factorialLater(n: bigint): Promise<bigint> {
  let r = 1n;
  for (let i = 2n; i <= n; i++) {
    r *= i;
    if (i % 10n === 0n) await delay(0);
  }

  return r;
}

export async function sumLater(xs: bigint[]): Promise<string> {
  const parts = await Promise.all(xs.map(async (x) => x ** 3n));
  const total = parts.reduce((a, b) => a + b, 0n);

  return `${parts.join(",")} = ${total}`;
}

export async function failLater(text: string): Promise<bigint> {
  await delay(0);

  return BigInt(text);
}

export function tupled(x: bigint): [bigint, string] {
  return [x << 1n, `${x}`];
}

export function records(xs: Record<string, bigint>): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(xs)) out[`${k}!`] = v - 1n;

  return out;
}
