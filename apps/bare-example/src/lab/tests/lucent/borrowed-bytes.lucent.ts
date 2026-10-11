// A synchronous function that only reads its bytes reads JavaScript's own,
// in place: a write JavaScript makes while the call runs shows, as it does
// in JavaScript.

/** Reads the bytes before and after `during` runs. */
export function sumAround(bytes: Uint8Array, during: () => void): string {
  const first = bytes[0] ?? -1;
  during();
  let total = 0;
  for (const b of bytes) total += b;
  return `${first} ${total} ${bytes.length} ${bytes[bytes.length - 1]}`;
}

/** An ArrayBuffer read through views of it. */
export function viewsAround(buffer: ArrayBuffer, during: () => void): string {
  const view = new Uint8Array(buffer);
  const before = view.join(",");
  during();
  const tail = view.subarray(1);
  return `${before} ${view.join(",")} ${tail.length} ${tail[0]} ${buffer.byteLength}`;
}

/** Part of a buffer: the view's bytes. */
export function partAround(bytes: Uint8Array, during: () => void): string {
  const before = [...bytes].join(",");
  during();
  return `${before} ${Array.from(bytes).join(",")} ${bytes.byteLength}`;
}

/** Copies made from them keep what the bytes held then. */
export function copiesAround(bytes: Uint8Array, during: () => void): string {
  const kept = bytes.slice();
  const also = new Uint8Array(bytes);
  during();
  return `${kept.join(",")} ${also.join(",")} ${bytes.join(",")} ${bytes.indexOf(9)}`;
}

/** Empty bytes, which JavaScript may give no memory for. */
export function lengthOf(bytes: Uint8Array): number {
  return bytes.length;
}
