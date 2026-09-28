// bigint arithmetic: every operator, at the edges of 64 bits and far beyond.

export function literals(): bigint[] {
  return [
    0n,
    1n,
    -1n,
    9007199254740991n,
    9007199254740993n,
    9223372036854775807n,
    9223372036854775808n,
    -9223372036854775808n,
    -9223372036854775809n,
    18446744073709551615n,
    18446744073709551616n,
    0xffff_ffff_ffff_ffff_ffffn,
    0o777n,
    0b1011n,
    1_000_000n,
    123456789012345678901234567890n,
  ];
}

export function arith(a: bigint, b: bigint): bigint[] {
  return [a + b, a - b, a * b, -a, ~a, a & b, a | b, a ^ b];
}

/** The quotient truncates toward zero; the remainder takes the dividend's sign. */
export function divide(a: bigint, b: bigint): string {
  return `${a / b} ${a % b}`;
}

export function power(base: bigint, exponent: bigint): bigint {
  return base ** exponent;
}

export function shifts(a: bigint, n: bigint): bigint[] {
  return [a << n, a >> n];
}

export function compare(a: bigint, b: bigint): boolean[] {
  return [a < b, a <= b, a > b, a >= b, a === b, a !== b, a == b, a != b];
}

/** A bigint against a number compares exact values: no rounding, NaN unordered. */
export function compareNumber(a: bigint, n: number): boolean[] {
  return [a < n, a <= n, a > n, a >= n, n < a, n <= a, n > a, n >= a];
}

export function truthiness(a: bigint): string {
  const out: string[] = [];

  if (a) out.push("if");
  else out.push("else");

  out.push(String(!a), String(a && 5n), String(a || 7n), a ? "t" : "f", String(Boolean(a)));

  let n = 0;
  let x = a;
  while (x) {
    x /= 10n;
    n++;
  }
  out.push(`digits ${n}`);

  return out.join(" ");
}

export function kind(a: bigint): string {
  return typeof a;
}

/** Increments and every compound assignment on a local. */
export function counters(start: bigint): bigint[] {
  let x = start;
  const out: bigint[] = [];

  out.push(x++);
  out.push(++x);
  out.push(x--);
  out.push(--x);
  x += 10n;
  out.push(x);
  x -= 3n;
  out.push(x);
  x *= -4n;
  out.push(x);
  x /= 3n;
  out.push(x);
  x %= 5n;
  out.push(x);
  x **= 3n;
  out.push(x);
  x <<= 70n;
  out.push(x);
  x >>= 3n;
  out.push(x);
  x &= 0xffff_ffff_ffff_ffff_ffffn;
  out.push(x);
  x |= 1n;
  out.push(x);
  x ^= 3n;
  out.push(x);

  return out;
}

class Tally {
  n = 0n;
  items: bigint[] = [1n, 2n];
}

let total = 0n;

/** Increments and compound assignments on fields, elements and module variables. */
export function places(): bigint[] {
  const t = new Tally();
  const box = { v: 10n };

  t.n++;
  ++t.n;
  t.n += 2n ** 64n;
  t.items[0]! += 5n;
  t.items[1]!--;
  t.items[1]! **= 70n;
  box.v *= box.v;
  box.v--;
  total += 1n;
  total++;

  const r = [t.n, t.items[0]!, t.items[1]!, box.v, total];

  total = 0n;
  return r;
}

let log = "";

function next(v: bigint): bigint {
  log += `${v};`;

  return v;
}

/** Operands run left to right, a compound assignment reads its target first. */
export function order(): string {
  log = "";

  const sum = next(1n) + next(2n) * next(3n);
  let x = 5n;
  x += (x = 100n) + next(x);
  const cmp = next(4n) < next(5n);

  return `${log} ${sum} ${x} ${cmp}`;
}

/** Around 2^k: the edges of the double, int64 and uint64 ranges. */
export function around(k: bigint): bigint[] {
  const p = 1n << k;

  return [p - 1n, p, p + 1n, -p - 1n, -p, -p + 1n];
}

/** Values of many limbs. */
export function large(): bigint[] {
  let f = 1n;
  for (let i = 1n; i <= 40n; i++) f *= i;

  const m = 2n ** 127n - 1n;
  const ten40 = 10n ** 40n;

  return [
    f,
    m % 1000000007n,
    ten40 / 7n,
    ten40 % 7n,
    -ten40 / 7n,
    (m * m) / (m - 2n),
    gcd(f, m * 6n),
    f >> 60n,
    -f >> 60n,
    f & (m >> 64n),
    ~f | 255n,
  ];
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }

  return a;
}

export function select(x: bigint): string {
  switch (x) {
    case 0n:
      return "zero";
    case 18446744073709551616n:
      return "2^64";
    case -1n:
      return "minus one";
    default:
      return "other";
  }
}
