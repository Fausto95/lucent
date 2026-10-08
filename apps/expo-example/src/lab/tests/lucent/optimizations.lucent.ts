// What T54's optimizations change in the generated code must never change
// what it computes. Each section has code the optimization applies to and
// similar code it must leave alone (test/ir/optimizations.test.ts checks
// which is which in the C++).

// --- Proven integer arithmetic: bounded writes in int64 ---------------------

/** Applies: every write is a non-negative remainder, so `sum` is an int64. */
export function boundedSum(n: number): number {
  let x = 2463534242;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    sum = (sum + (x >>> 0)) % 1000000007;
  }
  return sum;
}

/**
 * Applies: products of non-negative bounded values, and a compound remainder.
 * (`acc += x; acc %= m` does not: the analysis does not follow statement
 * order, and `+=` alone grows without bound.)
 */
export function compound(n: number): string {
  let acc = 0;
  let p = 1;
  let m = 12345;
  let grows = 0;
  for (let i = 0; i < n; i++) {
    acc = (acc + (i & 7)) % 1000;
    p = (p * ((i & 0xff) + 1)) % 65521;
    m %= 97;
    grows += i & 7;
    grows %= 1000;
  }
  return `${acc} ${p} ${m} ${grows}`;
}

/** Must not apply: a negative dividend's zero remainder is -0. */
export function negativeRemainder(): string {
  let r = 0;
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    r = (r - 4) % 2;
    out.push(1 / r);
  }
  return out.join(",");
}

/** Must not apply: `0 * -1` is -0, and `x % 0` NaN (`zero` is 0). */
export function signedProducts(zero: number): string {
  let a = 0;
  a = (a & 3) * -1;
  let b = 0;
  b = (b & 3) % (zero & 1);
  return `${1 / a} ${b}`;
}

/** Must not apply: growing without bound, past 2^53 where doubles round. */
export function unbounded(): string {
  let big = 1;
  for (let i = 0; i < 40; i++) big = big * 3 + 1;
  let c = 0;
  for (let i = 0; i < 10; i++) c++;
  let near = 9007199254740990;
  near += 3;
  return `${big} ${c} ${near}`;
}

/** Must not apply: a local that is sometimes fractional. */
export function sometimesFractional(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + (i & 3)) % 7;
  t = t / 2;
  return t;
}

// --- ToInt32 of doubles: int32 and uint32 values alike ----------------------

export function toInt32(xs: number[]): string {
  return xs.map((x) => `${x | 0}/${x >>> 0}/${x >> 1}`).join(" ");
}

/** CRC-32 reads uint32 values (half above 2^31) back out of a number[]. */
export function crc(n: number): number {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  let crc = 0xffffffff;
  for (let i = 0; i < n; i++) crc = table[(crc ^ (i & 0xff)) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// --- Callbacks a runtime method calls directly -------------------------------

/** Applies: arrow functions passed straight to Array's methods. */
export function directCallbacks(xs: number[], bias: number): string {
  const sorted = xs.slice().sort((a, b) => a - b);
  const desc = xs.slice().sort((a, b) => b - a + (bias > a ? 0 : 0));
  const mapped = xs.map((x, i) => x * bias + i);
  const kept = xs.filter((x) => x > bias);
  let seen = 0;
  xs.forEach((x) => {
    seen += x;
  });
  const total = xs.reduce((s, x) => s + x, bias);
  const found = xs.find((x) => x > 3);
  const at = xs.findIndex((x) => x === bias);
  const any = xs.some((x) => x < 0);
  const all = xs.every((x) => x > -100);
  return [sorted, desc, mapped, kept, seen, total, found, at, any, all].join("|");
}

/** Must not apply: a function value that is kept and used again, or a callback that is not passed straight. */
export function keptCallbacks(xs: number[]): string {
  const byValue = (a: number, b: number): number => a - b;
  const once = xs.slice().sort(byValue);
  const twice = xs.slice().sort(byValue);
  const calls: number[] = [];
  const counted = xs.map((x) => {
    calls.push(x);
    return x + calls.length;
  });
  return `${once} ${twice} ${counted} ${calls}`;
}

/** A callback that changes the array as it runs, and one that throws. */
export function mutatingCallbacks(): string {
  const xs = [1, 2, 3];
  const visited: number[] = [];
  xs.forEach((x) => {
    visited.push(x);
    if (x === 1) xs.push(4);
  });
  let message = "";
  try {
    [3, 1, 2].map((x) => {
      if (x === 1) throw new Error(`at ${x}`);
      return x;
    });
  } catch (e) {
    message = (e as Error).message;
  }
  return `${visited} ${xs} ${message}`;
}

// --- Strings: one allocation, inline or not ---------------------------------

/** Equal strings made different ways (inline, on the heap, two-byte) are the same key. */
export function stringKeys(): string {
  // Parts joined at run time: each key below is built a different way.
  const [ab, c, digits14, five, pi, approx, rest] = [
    "ab",
    "c",
    "12345678901234",
    "5",
    "π",
    "≈",
    "3.14",
  ];
  const counts = new Map<string, number>();
  const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const short = "abc";
  add(short);
  add(ab + c);
  add("xabcx".slice(1, 4));
  add(String.fromCharCode(97, 98, 99));
  const fifteen = "123456789012345";
  const sixteen = fifteen + "6";
  add(fifteen);
  add(digits14 + five);
  add(sixteen);
  add(`${fifteen}6`);
  add("1234567890123456".slice(0));
  const wide = pi + approx + rest;
  add(wide);
  add(pi + (approx + rest));
  add("é");
  add(String.fromCharCode(233));
  let keys = "";
  for (const [k, c] of counts) keys += `${k}:${c};`;
  return keys;
}

/** Building strings: appends that grow in place, widen, and share. */
export function building(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(97 + (i % 26));
  const shared = s;
  s += "!";
  let w = "ab";
  w += "Ω";
  w += "cd";
  for (let i = 0; i < 20; i++) w += i % 2 ? "z" : "ζ";
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(i % 3 ? `p${i}` : "π");
  const joined = parts.join("-");
  const numbers = [1, -2.5, 1e21, 0.1, -0].join(",");
  const split = joined.split("-").filter((p) => p === "π").length;
  return `${s.length} ${shared.length} ${s.slice(-3)} ${w} ${w.length} ${joined.length} ${split} ${numbers} ${joined.slice(0, 20)}`;
}

/** Appends to a field and a module variable: in place, read before the right side runs. */
class Log {
  text = "";
  add(part: string): void {
    this.text += part;
  }
  /** The right side replaces the field: the append is to what was read first. */
  replacing(): string {
    this.text += this.reset("new");
    return this.text;
  }
  reset(to: string): string {
    this.text = to;
    return "+";
  }
}

let journal = "";

function rewrite(): string {
  journal = "rewritten";
  return "!";
}

export function appends(n: number): string {
  const log = new Log();
  journal = "";
  for (let i = 0; i < n; i++) {
    log.add(i % 7 ? "ab" : "ψ");
    journal += `${i},`;
  }
  const held = log.text;
  log.add("|end");
  const before = journal;
  journal += rewrite();
  const tagged = `<${n}:${held.length}:${log.text.slice(-6)}:${before.length}>`;
  return `${tagged} ${log.text.length} ${held.length} ${journal} ${log.replacing()}`;
}

/** Numbers as strings: the integer fast path and the rest. */
export function numberStrings(): string {
  const xs = [
    0,
    -0,
    1,
    -1,
    42,
    2147483648,
    -9007199254740991,
    9007199254740992,
    1e21,
    1.5,
    -0.001,
    NaN,
    Infinity,
  ];
  return xs.map((x) => `${x}`).join(",");
}
