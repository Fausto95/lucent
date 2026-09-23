export function format(values: number[]): string[] {
  return values.map((v) => `${v}|${v.toFixed(2)}|${v.toString(16)}|${Math.round(v)}|${Math.floor(v)}|${Math.trunc(v)}|${v % 3}`);
}

export function bits(a: number, b: number): number[] {
  return [a & b, a | b, a ^ b, ~a, a << 3, a >> 2, a >>> 1, -a >>> 0, a ** 2];
}

export function parse(values: string[]): number[] {
  return values.map((s) => Number(s));
}

export function parseInts(values: string[]): number[] {
  return values.map((s) => parseInt(s, 10));
}

export function special(): string {
  const results = [0.1 + 0.2, 1 / 3, 1e21, 1e-7, -0, 100 / 0, -1 / 0, 0 / 0, 2 ** 53, 123456789.123456789, Number.MAX_SAFE_INTEGER, Number.EPSILON];
  return results.map((x) => String(x)).join(",");
}

export function mathFns(x: number): number[] {
  return [Math.abs(-x), Math.sqrt(x), Math.max(1, x, 3), Math.min(x, -2), Math.sign(-x), Math.hypot(3, 4), Math.cbrt(27), Math.clz32(x), Math.fround(x), Math.log2(8)];
}

export function precision(v: number): string {
  return [v.toPrecision(3), v.toExponential(2), v.toFixed(0), (v * 1000).toFixed(3)].join(" ");
}

export function checks(v: number): boolean[] {
  return [Number.isInteger(v), Number.isFinite(v), Number.isNaN(v), isNaN(v), Number.isSafeInteger(v)];
}

export function sum(xs: number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

export function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// JavaScript rounds the product before adding; a fused multiply-add would not.
export function multiplyAdd(a: number, b: number, c: number): number {
  return a * b + c;
}
