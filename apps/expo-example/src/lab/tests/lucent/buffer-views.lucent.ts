import { NativeBuffer } from "lucent:core";

/** What a borrow threw: the error's name. */
function nameOf(attempt: () => void): string {
  try {
    attempt();
    return "none";
  } catch (e) {
    return (e as Error).name;
  }
}

/** Samples written and read as floats; the same bytes as a Uint8Array reads them. */
export function samples(): string {
  using buffer = NativeBuffer.allocate(16);

  buffer.withWriteAs(Float32Array, (s) => {
    s[0] = 1.5;
    s[1] = 0.1;
    s.fill(-2, 2);
    s[9] = 4;
  });

  const floats = buffer.withReadAs(Float32Array, (s) => {
    const out: string[] = [];

    for (let i = 0; i < s.length; i++) out.push(String(s[i]));

    return `${out.join(",")} ${String(s[4])}`;
  });
  const bytes = buffer.withRead((b) => `${b[0]},${b[1]},${b[2]},${b[3]}`);

  return `${floats} ${bytes}`;
}

/** Each kind converts what is written as its typed array does; set copies another kind's values in. */
export function kinds(): string {
  using buffer = NativeBuffer.allocate(8);

  buffer.withWriteAs(Int16Array, (w) => {
    w[0] = 40000;
    w[1] = -1.9;
    w.set([7, 65544], 2);
  });

  const words = buffer.withReadAs(Uint16Array, (w) => `${w[0]},${w[1]},${w[2]},${w[3]}`);

  buffer.withWriteAs(Uint8ClampedArray, (c) => {
    c[0] = 300;
    c[1] = -5;
    c[2] = 2.5;
    c.set(new Float64Array([1.5, 254.5]), 3);
  });

  const clamped = buffer.withReadAs(Uint8Array, (b) => `${b[0]},${b[1]},${b[2]},${b[3]},${b[4]}`);

  buffer.withWriteAs(Uint8Array, (b) => {
    b.set([9, 300], 6);
  });

  const tail = buffer.withRead((b) => `${b[6]},${b[7]}`);

  buffer.withWriteAs(BigInt64Array, (big) => {
    big[0] = -2n;
  });

  const big = buffer.withReadAs(BigUint64Array, (b) => `${b[0]} ${b.length}`);

  return `${words} ${clamped} ${tail} ${big}`;
}

/** Bytes that are not whole elements, a write inside a read, and an index past the end. */
export function refusals(): string {
  using odd = NativeBuffer.allocate(6);

  return [
    nameOf(() => odd.withReadAs(Float32Array, (s) => s.length)),
    String(odd.withReadAs(Int16Array, (s) => s.length)),
    nameOf(() => odd.withRead(() => odd.withWriteAs(Uint16Array, (s) => s.length))),
    nameOf(() =>
      odd.withWriteAs(Int16Array, (s) => {
        s.set([1, 2], 2);
      }),
    ),
    String(odd.withReadAs(Uint8Array, (b) => b.length)),
  ].join(" ");
}

/** A buffer JavaScript then reads and writes through its own withReadAs and withWriteAs. */
export function made(): NativeBuffer {
  const buffer = NativeBuffer.allocate(8);

  buffer.withWriteAs(Int32Array, (w) => {
    w[0] = -5;
    w[1] = 7;
  });

  return buffer;
}

export function sum32(buffer: NativeBuffer): number {
  return buffer.withReadAs(Int32Array, (w) => {
    let total = 0;

    for (let i = 0; i < w.length; i++) total += w[i]!;

    return total;
  });
}
