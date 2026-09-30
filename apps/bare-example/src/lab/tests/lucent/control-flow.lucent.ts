// Branches, loops, jumps, assignments and narrowing, with an order trace:
// conditions run once per test, left to right, and a throw leaves every
// loop around it.

let trace = "";
let total = 0;
let limit: number | undefined = undefined;

export function reset(): void {
  trace = "";
  total = 0;
  limit = undefined;
}

export function trail(): string {
  return trace;
}

function note(tag: string): boolean {
  trace = `${trace}${tag} `;
  return true;
}

function check(tag: string, value: boolean): boolean {
  note(tag);
  return value;
}

function fail(tag: string): number {
  note(tag);
  throw new Error(`${tag} failed`);
}

export function sign(x: number): string {
  if (x > 0) return "positive";
  else if (x < 0) return "negative";
  else if (x === 0) return "zero";

  return "NaN";
}

export function clamp(x: number, lo: number, hi: number): number {
  let result = x;

  if (result < lo) {
    result = lo;
  } else if (result > hi) {
    result = hi;
  }
  return result;
}

export function sumTo(n: number): number {
  let sum = 0;
  let i = 1;

  while (i <= n) {
    sum += i;
    i++;
  }
  return sum;
}

export function countdown(n: number): string {
  let out = "";

  do {
    out += `${n} `;
    n--;
  } while (n > 0);
  return out;
}

export function oddsBelow(n: number): string {
  let out = "";

  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) continue;

    out = `${out}${i},`;
  }
  return out;
}

export function firstSquareOver(limit: number): number {
  let found = -1;

  for (let i = 0; ; i += 1) {
    if (i * i > limit) {
      found = i;
      break;
    }
  }
  return found;
}

export function pairs(n: number): string {
  let out = "";

  outer: for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (j === i) continue outer;

      if (i + j > 4) break outer;

      out += `${i}${j} `;
    }
  }
  return out;
}

export function skipBlock(early: boolean): string {
  let out = "start";

  section: {
    if (early) break section;

    out += " middle";
  }
  return `${out} end`;
}

export function doContinue(n: number): string {
  let out = "";
  let i = 0;

  do {
    i++;

    if (i === 2) continue;

    out += `${i}`;
  } while (i < n);
  return out;
}

export function conditions(): string {
  let out = "";

  while (check("a", true) && check("b", total < 2)) {
    total++;
    out += `${total}`;
  }

  if (check("c", false) || check("d", true)) out += "!";

  return out;
}

export function totals(): number {
  return total;
}

/** Throws out of both loops once `total` passes 3. */
export function throwsOut(n: number): void {
  for (let i = 0; i < n; i++) {
    while (true) {
      total += 1;

      if (total > 3) fail(`at${i}`);

      break;
    }
  }
}

export function ternary(x: number): string {
  const kind = x > 0 ? "up" : x < 0 ? "down" : "flat";
  const size = x > 100 || x < -100 ? "big" : "small";

  return `${kind} ${size} ${x !== x ? "nan" : "number"}`;
}

export function increments(): string {
  let a = 5;
  const pre = ++a;
  const post = a++;
  const down = --a;
  const after = a--;

  total = 10;

  const g = total++;

  return `${pre} ${post} ${down} ${after} ${a} ${g} ${total}`;
}

export function bits(x: number, y: number): string {
  let acc = x;

  acc |= y;
  acc &= 0xff;
  acc ^= 0x0f;
  acc <<= 3;
  acc >>= 1;

  const unsigned = -1 >>> 28;
  const wrapped = (2 ** 31) | 0;
  const inverted = ~x;

  return `${acc} ${unsigned} ${wrapped} ${inverted} ${x & -y} ${1.9 | 0} ${-1.9 | 0}`;
}

export function optionals(x: number | undefined): string {
  let out = "";

  if (x !== undefined) out += `has ${x + 1}`;
  else out += "none";

  if (x === undefined) out += " undefined";

  const fallback = x ?? -1;

  limit ??= fallback * 2;
  limit ||= 7;
  return `${out} ${fallback} ${limit} ${x != null ? x + 0.5 : "absent"}`;
}

export function kinds(v: string | number | boolean): string {
  if (typeof v === "string") return `string ${v}!`;

  if (typeof v === "number") return `number ${v * 2}`;

  return v ? "yes" : "no";
}

export function truthy(s: string, n: number): string {
  let out = "";

  if (s) out += "s";

  if (!n) out += "!n";

  if (!s && n) out += "n";

  return out || "none";
}

export function reassign(n: number, label: string): string {
  n = n * 2;
  label += "!";

  if (n > 10) {
    const label2 = `${label}${n}`;

    return label2;
  }
  return label;
}

export function scopes(n: number): string {
  let out = "";

  {
    const x = n + 1;

    out += `${x}`;
  }
  {
    const x = `${n}`;

    out += x;
  }
  return out;
}

export function nanLoop(): number {
  let steps = 0;
  let x = 0 / 0;

  while (!(x >= 0)) {
    steps++;

    if (steps > 3) x = 0;
  }
  return steps;
}

export function grade(score: number): string {
  let out = "";

  switch (tens(score)) {
    case 10:
    case 9:
      out = "A";
      break;
    case 8:
      out = "B";
      break;
    case 7:
      out = "C";
    // falls through
    case 6:
      out += "D";
      break;
    default:
      out = "F";
  }
  return out;
}

/** The tens digit of a score from 0 to 100. */
function tens(score: number): number {
  return (score - (score % 10)) / 10;
}
