// bigint conversions: from and to numbers, strings and booleans, and wrapping.

export function fromNumber(n: number): bigint {
  return BigInt(n);
}

export function fromString(s: string): bigint {
  return BigInt(s);
}

export function fromBoolean(b: boolean): bigint[] {
  return [BigInt(b), BigInt(!b)];
}

export function same(x: bigint): bigint {
  return BigInt(x);
}

export function toNumber(x: bigint): number {
  return Number(x);
}

export function strings(x: bigint): string[] {
  return [
    String(x),
    `${x}`,
    `<${x}|${-x}>`,
    "" + x,
    x + "!",
    x.toString(),
    x.toString(16),
    x.toString(2),
    x.toString(36),
    x.valueOf().toString(),
  ];
}

export function radix(x: bigint, r: number): string {
  return x.toString(r);
}

export function wrap(bits: number, x: bigint): bigint[] {
  return [BigInt.asIntN(bits, x), BigInt.asUintN(bits, x)];
}

/** Errors thrown and caught in Lucent. */
export function attempt(what: string, text: string): string {
  try {
    switch (what) {
      case "number":
        return String(BigInt(Number(text)));
      case "string":
        return String(BigInt(text));
      case "json":
        return JSON.stringify({ id: BigInt(text) });
      case "radix":
        return 10n.toString(Number(text));
      case "bits":
        return String(BigInt.asIntN(Number(text), 5n));
      default:
        return "?";
    }
  } catch (e) {
    const err = e as Error;

    return `${err.name}: ${err.message} ${err instanceof SyntaxError} ${err instanceof RangeError} ${err instanceof TypeError}`;
  }
}

export function json(x: bigint): string {
  return JSON.stringify([x]);
}

export function roundTrip(x: bigint): boolean {
  return BigInt(String(x)) === x && BigInt(`0x${x.toString(16)}`) === x;
}
