/**
 * Writes the number-to-string differential corpus: doubles the runtime must
 * print exactly as JavaScript (this node) does, with String(x) and the
 * toString(radix), toFixed, toExponential and toPrecision forms. Seeded, so
 * the corpus is the same on every run; run.sh writes it to TMPDIR and
 * number_test.cpp checks each line.
 *
 *   node packages/runtime/test/number/corpus.ts <out-file>
 *
 * One case per line, tab-separated: the operation, the double's IEEE bits
 * in hex, the argument (`-` for none), then JavaScript's string.
 */
import fs from "node:fs";

const out = process.argv[2];
if (!out) throw new Error("usage: corpus.ts <out-file>");

// mulberry32: small, seeded, the same everywhere.
let seed = 0x6e756d73;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const u32 = () => Math.floor(random() * 4294967296);
const below = (n: number) => Math.floor(random() * n);

const view = new DataView(new ArrayBuffer(8));

function fromBits(bits: bigint): number {
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

function bitsOf(d: number): bigint {
  view.setFloat64(0, d);
  return view.getBigUint64(0);
}

/** The next double up (towards +Infinity), or down. */
const nextUp = (d: number) => (d === 0 ? 5e-324 : fromBits(bitsOf(d) + (d > 0 ? 1n : -1n)));
const nextDown = (d: number) => -nextUp(-d);

// --- the doubles ----------------------------------------------------------------

const doubles: number[] = [
  0,
  -0,
  NaN,
  Infinity,
  -Infinity,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  Number.EPSILON,
  Number.MAX_SAFE_INTEGER,
  2 ** 53,
  2 ** 53 + 2,
  0.1,
  0.2,
  0.1 + 0.2,
  1 / 3,
  2 / 3,
  Math.PI,
  Math.E,
  123.456,
  -1.5,
  // The finding: 2^89, the correctly rounded 16 digits of which do not
  // round-trip, where a 16-digit string does.
  2 ** 89,
  // The smallest normal and the largest subnormal.
  2 ** -1022,
  nextDown(2 ** -1022),
];

// Every power of two: the rounding interval below one is half the one above.
for (let e = -1074; e <= 1023; e++) doubles.push(2 ** e);

// Powers of ten and their neighbours, and the thresholds of the exponent form.
for (let e = -323; e <= 308; e++) {
  const v = Number(`1e${e}`);
  doubles.push(v, nextUp(v), nextDown(v));
}
for (const v of [1e21, 1e-7, 1e-6, 1e20, 999999999999999900000, 1.5e-7, 9.5e-7])
  doubles.push(v, nextUp(v), nextDown(v));

// Halfway-looking decimals: 17 significant digits ending in 5.
for (let i = 0; i < 2000; i++) {
  const digits = `${1 + below(9)}${String(u32()).padStart(10, "0").slice(0, 10)}${String(below(100000)).padStart(5, "0")}5`;
  doubles.push(Number(`${digits.slice(0, 1)}.${digits.slice(1)}e${below(600) - 300}`));
}

// Short decimals, which print as they were written.
for (let i = 0; i < 2000; i++)
  doubles.push(Number(`${below(1000000)}e${below(40) - 20}`) * (random() < 0.5 ? -1 : 1));

// Subnormals.
for (let i = 0; i < 1000; i++)
  doubles.push(fromBits((BigInt(below(1 << 20)) << 32n) | BigInt(u32())));

// Integers around 2^53 and the 1e21 threshold.
for (let i = 0; i < 500; i++) {
  doubles.push(2 ** 53 + below(1 << 20) * 2 - (1 << 20));
  doubles.push(1e21 * (0.5 + random()));
}

// Random bit patterns: every exponent, every sign.
for (let i = 0; i < 30000; i++) doubles.push(fromBits((BigInt(u32()) << 32n) | BigInt(u32())));

// --- the cases ------------------------------------------------------------------

const lines: string[] = [];
const hex = (d: number) => bitsOf(d).toString(16).padStart(16, "0");
const add = (op: string, d: number, arg: number | undefined, text: string) =>
  lines.push(`${op}\t${hex(d)}\t${arg ?? "-"}\t${text}`);

for (const d of doubles) {
  add("str", d, undefined, String(d));
  add("exp", d, undefined, d.toExponential());

  const radix = 2 + below(35);
  add("radix", d, radix, d.toString(radix));

  const fixed = below(101);
  add("fixed", d, fixed, d.toFixed(fixed));

  // Mostly the short forms apps use, sometimes up to the limit.
  const precision = 1 + (random() < 0.8 ? below(21) : below(100));
  add("precision", d, precision, d.toPrecision(precision));

  const fraction = random() < 0.8 ? below(21) : below(101);
  add("exp", d, fraction, d.toExponential(fraction));
}

fs.writeFileSync(out, `${lines.join("\n")}\n`);
