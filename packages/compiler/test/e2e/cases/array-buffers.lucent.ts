import { compute } from "lucent:core";

/** Views over one buffer share its bytes; `slice` copies them. */
export function views(): string {
  const ab = new ArrayBuffer(8);
  const all = new Uint8Array(ab);
  const mid = new Uint8Array(ab, 2, 3);
  const tail = new Uint8Array(ab, 6);

  mid[0] = 7;
  tail[1] = 9;

  const copy = ab.slice(-3);

  all[7] = 1;

  return [
    ab.byteLength,
    all.join(","),
    `${mid.byteOffset}+${mid.length}`,
    `${tail.byteOffset}+${tail.length}`,
    all.buffer === ab,
    mid.buffer === tail.buffer,
    new Uint8Array(copy).join(","),
    ab.slice(2, 4).byteLength,
    ab.slice(5, 2).byteLength,
    new Uint8Array(mid.buffer, 2, 1)[0],
  ].join(" ");
}

/** JavaScript's length and range checks, by the error's name. */
export function checks(): string {
  const ab = new ArrayBuffer(4);
  const attempts: (() => number)[] = [
    () => new ArrayBuffer(-1).byteLength,
    () => new ArrayBuffer(2.7).byteLength,
    () => new ArrayBuffer(Number.NaN).byteLength,
    () => new Uint8Array(ab, 5).length,
    () => new Uint8Array(ab, 4).length,
    () => new Uint8Array(ab, 2, 3).length,
    () => new Uint8Array(ab, 1, 3).length,
  ];

  return attempts
    .map((attempt) => {
      try {
        return String(attempt());
      } catch (e) {
        return (e as Error).name;
      }
    })
    .join(",");
}

export function sum(buffer: ArrayBuffer): number {
  let total = 0;

  for (const b of new Uint8Array(buffer)) total += b;

  return total;
}

/** A buffer made here reaches JavaScript as an ArrayBuffer. */
export function filled(n: number, value: number): ArrayBuffer {
  return new Uint8Array(n).fill(value).buffer;
}

export function reversed(buffer: ArrayBuffer): ArrayBuffer {
  const from = new Uint8Array(buffer);

  return from.map((_, i) => from[from.length - 1 - i]!).buffer;
}

export function describe(buffer: ArrayBuffer | undefined): string {
  if (buffer === undefined) return "none";

  return `${typeof buffer} ${String(buffer)} ${JSON.stringify({ buffer, size: buffer.byteLength })}`;
}

export type Value = boolean | string | number | ArrayBuffer;

/** MMKV's shape: one store of every kind of value, buffers included. */
export class Store {
  private values = new Map<string, Value>();

  set(key: string, value: Value): void {
    this.values.set(key, value);
  }

  getBuffer(key: string): ArrayBuffer | undefined {
    const v = this.values.get(key);

    return v instanceof ArrayBuffer ? v : undefined;
  }

  kinds(): string {
    return [...this.values.entries()]
      .map(([k, v]) => `${k}:${v instanceof ArrayBuffer ? `buffer(${v.byteLength})` : typeof v}`)
      .join(",");
  }
}

function checksum(buffer: ArrayBuffer): number {
  return new Uint8Array(buffer).reduce((a, b) => (a * 31 + b) % 65521, 1);
}

/** A buffer copied to a compute task, the caller's own left as it was. */
export async function digest(n: number): Promise<string> {
  const ab = new ArrayBuffer(n);
  const bytes = new Uint8Array(ab);

  for (let i = 0; i < n; i++) bytes[i] = i * 7;

  const result = await compute(checksum, ab);

  return `${result} ${ab.byteLength} ${bytes[1]}`;
}
