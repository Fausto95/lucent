/** Each kind's conversion of what is written: wrapping, clamping, the nearest float, 64-bit wrapping. */
export function conversions(): string {
  return [
    new Int8Array([127, 128, -129, 255.9, Number.NaN]).join(","),
    new Uint8ClampedArray([-5, 0.5, 1.5, 2.5, 254.5, 300, Number.NaN]).join(","),
    new Int16Array([32768, -32769]).join(","),
    new Uint16Array([-1, 65536]).join(","),
    new Int32Array([2147483648, -1.5]).join(","),
    new Uint32Array([-1, 4294967296]).join(","),
    new Float32Array([0.1, 16777217]).join(","),
    new Float64Array([0.1, -0]).join(","),
    new BigInt64Array([18446744073709551615n, -2n]).join(","),
    new BigUint64Array([-1n]).join(","),
  ].join(" ");
}

/** Views of one buffer at aligned offsets share its bytes, which the host stores little-endian. */
export function views(): string {
  const buffer = new ArrayBuffer(8);
  const bytes = new Uint8Array(buffer);
  const words = new Uint16Array(buffer, 2, 2);
  const floats = new Float32Array(buffer, 4);

  words[0] = 0x0102;
  floats[0] = 1.5;

  const attempts: (() => number)[] = [
    () => new Uint32Array(buffer, 2).length,
    () => new Uint32Array(new ArrayBuffer(6)).length,
    () => new Float64Array(buffer, 0, 2).length,
    () => new Int16Array(-1).length,
  ];

  return [
    bytes.join(","),
    `${words.byteOffset}+${words.byteLength}/${words.length}`,
    floats.length,
    words.buffer === buffer,
    Float32Array.BYTES_PER_ELEMENT,
    words.BYTES_PER_ELEMENT,
    attempts
      .map((attempt) => {
        try {
          return String(attempt());
        } catch (e) {
          return (e as Error).name;
        }
      })
      .join(","),
  ].join(" ");
}

/** subarray shares, slice copies; set and the constructors convert between kinds. */
export function sharing(): string {
  const f = new Float64Array([1.5, -0, Number.NaN, 3]);

  f.subarray(1, 2)[0] = 2;

  const copy = f.slice(0, 2);

  copy[0] = 9;

  const narrow = new Int8Array(4);

  narrow.set(f);

  let overflow = "none";

  try {
    narrow.set(f, 1);
  } catch (e) {
    overflow = (e as Error).name;
  }

  return [
    f.join(","),
    copy.join(","),
    narrow.join(","),
    overflow,
    new Float32Array(new Int16Array([-2, 7])).join(","),
    Int16Array.from([1.9, -1.9]).join(","),
    Uint16Array.of(1, 65537).join(","),
    new Float64Array(3).join(","),
  ].join(" ");
}

/** %TypedArray%'s methods: indexOf never finds NaN and includes does; sort is numeric. */
export function methods(): string {
  const g = new Float64Array([3, Number.NaN, -0, 0, -1, 10]);
  const sorted = g.toSorted();

  return [
    g.indexOf(Number.NaN),
    g.includes(Number.NaN),
    g.indexOf(0),
    g.lastIndexOf(0),
    sorted.join(","),
    1 / (sorted[1] ?? 1) === -Infinity,
    g.toReversed().join(","),
    g.at(-1),
    g.at(6),
    // oxlint-disable-next-line unicorn/no-confusing-array-with -- a negative index is the case
    g.with(-1, 4).join(","),
    new Int16Array([1, 2, 3, 4, 5]).copyWithin(0, 3).join(","),
    new Int16Array([5, 1, 4]).sort((a, b) => b - a).join(","),
    new Int16Array([1, 2, 3]).reduce((a, b) => a + b),
    new Int16Array([1, 2, 3]).reduceRight((a, b) => `${a}${b}`, ""),
    new Uint8Array([1, 2, 3, 4]).filter((x) => x % 2 === 0).join(","),
    new Int32Array([1, 2, 3]).map((x) => x * 10).join(","),
    new Float32Array([1, 2]).some((x) => x > 1),
    new Float32Array([1, 2]).every((x) => x > 1),
    new Int8Array([4, 5, 6]).find((x) => x > 4),
    new Int8Array([4, 5, 6]).findLastIndex((x) => x < 6),
    new BigInt64Array([3n, 1n, 2n]).toSorted().join(","),
    new Uint8Array([3, 1, 2]).sort().join(","),
  ].join(" ");
}

/** Iterating, indexing out of range, and writing past the end, which is ignored. */
export function elements(): string {
  const a = new Uint16Array([10, 20, 30]);
  let total = 0;

  for (const x of a) total += x;

  a[3] = 7;

  const big = new BigUint64Array(2);

  big[1] = 5n;

  let sum = 0n;

  for (const x of big) sum += x;

  const listed: string[] = [];

  for (const [i, x] of a.entries()) listed.push(`${i}=${x}`);

  return [
    total,
    a[1],
    String(a.at(3)),
    a.length,
    [...a].join("|"),
    sum,
    big[0],
    listed.join(","),
    [...a.keys()].join(","),
    [...big.values()].join(","),
  ].join(" ");
}

/** What crosses to JavaScript: a copy each way, of the kind it is. */
export function scaled(samples: Float32Array, by: number): Float32Array {
  return samples.map((s) => s * by);
}

/** Read in place, lent for the call: a view of JavaScript's own bytes. */
export function peak(samples: Float32Array): number {
  let top = 0;

  for (const s of samples) top = Math.max(top, Math.abs(s));

  return top + (samples.at(-1) ?? 0);
}

export function sumOf(samples: Int16Array): number {
  return samples.reduce((a, b) => a + b, 0);
}

export function counts(n: number): BigUint64Array {
  const out = new BigUint64Array(n);

  for (let i = 0; i < n; i++) out[i] = BigInt(i) * 1000000000000n;

  return out;
}

export function isView(x: Float64Array | ArrayBuffer): boolean {
  return ArrayBuffer.isView(x);
}

export function kinds(x: Float32Array | Int8Array): string {
  return x instanceof Float32Array ? "f32" : x instanceof Int8Array ? "i8" : "other";
}
