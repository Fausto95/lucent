// Conversions and operators over unions with bigint: SDK results that are
// a constant group's number or a 64-bit value, possibly absent.

export function toNumber(x: bigint | number): number {
  return Number(x);
}

export function toNumberOptional(x?: bigint): number {
  return Number(x);
}

export function toNumberNullable(x: bigint | null): number {
  return Number(x);
}

export function toNumberEither(x?: bigint | number | null): number {
  return Number(x);
}

export function toNumberOfAnything(x: bigint | number | string | boolean | undefined): number {
  return Number(x);
}

export function toBigInt(x: bigint | number): bigint {
  return BigInt(x);
}

export function toBigIntOfAnything(x: bigint | number | string | boolean): bigint {
  return BigInt(x);
}

export function strings(x?: bigint | number | null): string[] {
  return [String(x), `${x}`, "v=" + x, x + "!"];
}

export function compare(a: bigint | number, b: bigint | number): boolean[] {
  return [a < b, a <= b, a > b, a >= b, a === b, a !== b];
}

export function compareOptional(a: bigint | undefined, b: bigint): boolean[] {
  return [a === b, a !== b, a === undefined];
}

export function negate(a: bigint | number): bigint | number {
  return -a;
}

export function flip(a: bigint | number): bigint | number {
  return ~a;
}

export function steps(a: bigint | number): string[] {
  let b = a;
  const before = b++;
  const after = --b;
  --b;
  return [`${before}`, `${after}`, `${b}`, typeof b];
}
