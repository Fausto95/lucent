/**
 * Writes the BigInt differential corpus: every case the runtime's BigInt
 * must agree with JavaScript on, with the answer JavaScript (this node)
 * gives. Seeded, so the corpus is the same on every run; run.sh writes it
 * to TMPDIR and bigint_test.cpp checks each line.
 *
 *   node packages/runtime/test/bigint/corpus.ts <out-file>
 *
 * One case per line, tab-separated: the operation, its arguments, then the
 * expected result. BigInts are decimal; doubles are `d:` and their IEEE
 * bits in hex; strings to parse are `s:` and their UTF-8 in hex; a thrown
 * error is `!` and its name.
 */
import fs from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("usage: corpus.ts <out-file>");

// mulberry32: small, seeded, the same everywhere.
let seed = 0x5eed1234;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

/** A random non-negative bigint below 2^bits. */
function randomBits(bits: number): bigint {
  let v = 0n;
  for (let done = 0; done < bits; done += 32)
    v = (v << 32n) | BigInt(Math.floor(random() * 4294967296));
  return v & ((1n << BigInt(bits)) - 1n);
}

// --- the values -----------------------------------------------------------------

const values: bigint[] = [0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, 10n, -10n, 255n, 256n, 1000n, -1000n];

for (const k of [8, 31, 32, 33, 52, 53, 54, 62, 63, 64, 65, 95, 96, 127, 128, 129, 191, 192, 256]) {
  for (const d of [-2n, -1n, 0n, 1n, 2n]) {
    const v = (1n << BigInt(k)) + d;
    values.push(v, -v);
  }
}

for (const k of [8, 32, 53, 64, 100])
  values.push((1n << BigInt(k)) - 1n, -((1n << BigInt(k)) - 1n));

for (let i = 0; i < 160; i++) {
  const v = randomBits(1 + Math.floor(random() * 400));
  values.push(random() < 0.5 ? -v : v);
}

/** Values small enough to raise to powers. */
const bases = values.filter((v) => (v < 0n ? -v : v) < 1n << 70n);

// --- the doubles ---------------------------------------------------------------

function bits(d: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  return "d:" + view.getBigUint64(0).toString(16).padStart(16, "0");
}

const doubles: number[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1.5,
  -1.5,
  2.5,
  3,
  42,
  -42,
  123456789.75,
  2 ** 31,
  2 ** 32,
  2 ** 53,
  2 ** 53 + 2,
  -(2 ** 53),
  2 ** 63,
  -(2 ** 63),
  2 ** 64,
  -(2 ** 64),
  1e20,
  1e21,
  1e300,
  -1e300,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  NaN,
  Infinity,
  -Infinity,
];

for (let i = 0; i < 60; i++) {
  const magnitude = 2 ** Math.floor(random() * 200);
  const d = Math.floor(random() * magnitude) * (random() < 0.5 ? -1 : 1);
  doubles.push(d, d + 0.25);
}

// Each value's own Number(): where rounding decides the comparison.
for (const v of values) doubles.push(Number(v));

// --- the cases -------------------------------------------------------------------

const lines: string[] = [];

function run(op: string, args: string[], f: () => unknown): void {
  let result: string;

  try {
    const r = f();
    if (typeof r === "bigint") result = r.toString();
    else if (typeof r === "number") result = bits(r);
    else result = String(r);
  } catch (e) {
    result = "!" + (e as Error).name;
  }

  lines.push([op, ...args, result].join("\t"));
}

const binary: Record<string, (a: bigint, b: bigint) => unknown> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  mod: (a, b) => a % b,
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
  cmp: (a, b) => (a < b ? -1n : a > b ? 1n : 0n),
  eq: (a, b) => a === b,
};

const special = values.slice(0, 60);
const pairs: [bigint, bigint][] = [];
for (const a of special) for (const b of special) pairs.push([a, b]);
for (let i = 0; i < 4000; i++) pairs.push([pick(values), pick(values)]);

for (const [a, b] of pairs) {
  for (const [op, f] of Object.entries(binary)) run(op, [String(a), String(b)], () => f(a, b));
}

const counts = [
  -300n,
  -65n,
  -64n,
  -63n,
  -33n,
  -32n,
  -31n,
  -1n,
  0n,
  1n,
  2n,
  31n,
  32n,
  33n,
  63n,
  64n,
  65n,
  100n,
  300n,
];
for (const v of values) {
  for (const n of counts) {
    run("shl", [String(v), String(n)], () => v << n);
    run("shr", [String(v), String(n)], () => v >> n);
  }
}

// >>> has no bigint form: it throws a TypeError (TypeScript rejects it, so
// the operands are hidden from it).
const one: unknown = 1n;
run("ushr", ["1", "1"], () => (one as number) >>> (one as number));

for (const b of bases) {
  for (const e of [-1n, 0n, 1n, 2n, 3n, 5n, 7n, 13n, 31n, 64n])
    run("pow", [String(b), String(e)], () => b ** e);
}

for (const v of values) {
  run("neg", [String(v)], () => -v);
  run("not", [String(v)], () => ~v);
  run("num", [String(v)], () => Number(v));
  run("i64", [String(v)], () => (BigInt.asIntN(64, v) === v ? v : fail()));
  run("u64", [String(v)], () => (BigInt.asUintN(64, v) === v ? v : fail()));
  run("wi64", [String(v)], () => BigInt.asIntN(64, v));
  run("wu64", [String(v)], () => BigInt.asUintN(64, v));

  for (const radix of [2, 7, 8, 10, 16, 36, 1, 37])
    run("tostr", [String(v), String(radix)], () => v.toString(radix));

  for (const n of [0, 1, 7, 8, 31, 32, 53, 63, 64, 65, 100, 128, 200, -1, 1.5]) {
    run("intn", [String(n), String(v)], () => BigInt.asIntN(n, v));
    run("uintn", [String(n), String(v)], () => BigInt.asUintN(n, v));
  }
}

function fail(): never {
  throw new RangeError("out of range");
}

for (const d of doubles) run("fromnum", [bits(d)], () => BigInt(d));

// Each value against its own Number(): equal only when exactly representable.
// (Loose equality, which TypeScript rejects between the two types.)
const against = (v: bigint, d: number) =>
  v < d ? "<" : v > d ? ">" : (v as unknown as number) == d ? "=" : "u";
for (const v of values) run("cmpnum", [String(v), bits(Number(v))], () => against(v, Number(v)));

for (let i = 0; i < 3000; i++) {
  const v = pick(values);
  const d = pick(doubles);
  run("cmpnum", [String(v), bits(d)], () => against(v, d));
}

// --- parsing ---------------------------------------------------------------------

const texts = [
  "",
  " ",
  "0",
  "-0",
  "+0",
  "00012",
  "  42  ",
  " \t\n42 ",
  "\uFEFF7",
  "\u00A042\u2028",
  "\u30007",
  "-12",
  "+12",
  "0x1f",
  "0X1F",
  "0o17",
  "0O17",
  "0b101",
  "0B101",
  "0x",
  "0o",
  "0b",
  "-0x1",
  "+0x1",
  "0x-1",
  "1n",
  "1.5",
  "1.",
  ".5",
  "1e3",
  "12_3",
  "Infinity",
  "NaN",
  "0b102",
  "0o8",
  "0xg",
  "\u0663",
  "--1",
  "+-1",
  "-",
  "+",
  "1 2",
  "0x 1",
  "18446744073709551616",
  "-9223372036854775809",
  "0xffffffffffffffffffffffff",
];

for (const v of values) {
  texts.push(String(v));
  if (v >= 0n)
    texts.push("0x" + v.toString(16), "0o" + v.toString(8), "0b" + v.toString(2), " +" + v + "\n");
}

for (const t of texts)
  run("parse", ["s:" + Buffer.from(t, "utf8").toString("hex")], () => BigInt(t));

fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`bigint corpus: ${lines.length} cases`);
