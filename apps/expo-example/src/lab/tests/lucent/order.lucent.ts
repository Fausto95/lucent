// Evaluation order: operands and arguments run left to right, and a call
// that throws stops everything after it.

let log = "";
let calls = 0;

export function reset(): void {
  log = "";
  calls = 0;
}

export function trail(): string {
  return log;
}

function next(tag: string): string {
  calls = calls + 1;
  log = `${log}${tag}${calls} `;
  return `${tag}${calls}`;
}

function fail(tag: string): string {
  log = log + tag + "! ";
  throw new Error(`${tag} failed`);
}

function combine(left: string, right: string): string {
  return left + "+" + right;
}

export function pair(): string {
  return combine(next("l"), next("r"));
}

export function firstThrows(): string {
  return combine(fail("l"), next("r"));
}

export function secondThrows(): string {
  return combine(next("l"), fail("r"));
}

export function operands(): string {
  return next("a") + next("b") + next("c");
}

export function locals(): string {
  const first = next("x");
  let second = next("y");

  second = combine(second, next("z"));
  return combine(second, first);
}

export function counted(): number {
  const before = calls;

  next("n");
  return calls - before + calls * 10;
}

function scale(x: number, factor: number): number {
  return x * factor;
}

export function arithmetic(a: number, b: number): number {
  const sum = a + b;
  const product = scale(sum, 3) - b / 4;

  return (product % 7) + 2 ** -1;
}

/** Rounded twice, as JavaScript does: never a fused multiply-add. */
export function mulAdd(a: number, b: number, c: number): number {
  return a * b + c;
}

export function numbers(): string {
  return `${-0} ${0 / 0} ${1 / 0} ${-1 / 0} ${0.1 + 0.2} ${-7 % 3} ${7 % -3} ${2 ** 0.5} ${1e21} ${123456789012345680000}`;
}

export function negate(x: number): number {
  return -x;
}

export function compare(a: number, b: number, s: string, t: string): string {
  return `${a < b} ${a >= b} ${a === b} ${a !== b} ${s < t} ${s === t} ${!(a > b)}`;
}
