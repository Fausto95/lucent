import { compute, NativeBuffer } from "lucent:core";

function failure(e: Error): string {
  return `${e.name}: ${e.message}`;
}

/** A buffer's bytes move into an ArrayBuffer, uncopied: the buffer refuses them from then on. */
export function moved(): string {
  const buffer = NativeBuffer.allocate(4);
  // An alias the compiler cannot tell is moved: it refuses at run time.
  const alias = buffer;
  buffer.withWrite((bytes) => bytes.fill(3));
  const before = NativeBuffer.stats();
  const ab = buffer.transferToArrayBuffer();
  const after = NativeBuffer.stats();
  let refused = "";
  try {
    alias.withRead((bytes) => bytes.length);
  } catch (e) {
    refused = failure(e as Error);
  }
  return [
    ab.byteLength,
    new Uint8Array(ab).join(","),
    alias.byteLength,
    refused,
    after.copies - before.copies,
    after.transfers - before.transfers,
  ].join(" ");
}

/** Returned to JavaScript, the ArrayBuffer holds the buffer's bytes. */
export function filled(size: number, value: number): ArrayBuffer {
  const buffer = NativeBuffer.allocate(size);
  buffer.withWrite((bytes) => bytes.fill(value));
  return buffer.transferToArrayBuffer();
}

function fill(buffer: NativeBuffer): NativeBuffer {
  buffer.withWrite((bytes) => bytes.fill(9));
  return buffer;
}

/** A task fills a buffer it was handed; its bytes come back as an ArrayBuffer. */
export async function fromTask(size: number): Promise<number> {
  const back = await compute(fill, NativeBuffer.allocate(size));
  const ab = back.transferToArrayBuffer();
  return new Uint8Array(ab).reduce((a, b) => a + b, 0);
}

/** A borrowed, closed or transferred buffer does not move. */
export function refusals(): string {
  const out: string[] = [];
  const borrowed = NativeBuffer.allocate(2);
  try {
    borrowed.withRead(() => borrowed.transferToArrayBuffer().byteLength);
  } catch (e) {
    out.push(failure(e as Error));
  }
  out.push(String(borrowed.byteLength));
  const closed = NativeBuffer.allocate(2);
  closed.close();
  try {
    closed.transferToArrayBuffer();
  } catch (e) {
    out.push(failure(e as Error));
  }
  const gone = NativeBuffer.allocate(2);
  const goneAlias = gone;
  gone.transfer().close();
  try {
    goneAlias.transferToArrayBuffer();
  } catch (e) {
    out.push(failure(e as Error));
  }
  return out.join(" | ");
}

/** A buffer for JavaScript to move: four bytes of 1. */
export function make(size: number): NativeBuffer {
  const buffer = NativeBuffer.allocate(size);
  buffer.withWrite((bytes) => bytes.fill(1));
  return buffer;
}
