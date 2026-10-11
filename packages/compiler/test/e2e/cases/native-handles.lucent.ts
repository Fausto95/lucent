// NativeHandle: an address for other native code, held valid until it is
// released. A buffer's handle borrows its bytes for read meanwhile.
// Addresses differ between runs, so this case prints only what they mean.
import { NativeBuffer, NativeHandle } from "lucent:core";

function attempt(f: () => void): string {
  try {
    f();
    return "ok";
  } catch (e) {
    return (e as Error).name;
  }
}

/** While a handle is held, reads go on; writes, transfers and closing refuse. */
export function borrows(): string {
  const buffer = NativeBuffer.allocate(8);
  const handle = buffer.handle();
  const held = [
    `${handle.pointer !== 0n} ${handle.released}`,
    attempt(() => {
      buffer.withRead((bytes) => bytes.length);
    }),
    attempt(() => {
      buffer.withWrite((bytes) => bytes.fill(1));
    }),
    attempt(() => {
      buffer.transfer();
    }),
    attempt(() => buffer.close()),
  ];
  const released = `${handle.release()} ${handle.release()} ${handle.pointer} ${handle.released}`;
  const after = attempt(() => {
    buffer.withWrite((bytes) => bytes.fill(2));
  });
  buffer.close();
  return `${held.join(" ")} | ${released} | ${after}`;
}

/** A handle needs bytes: an empty or closed buffer has no address. */
export function refused(): string {
  const closed = NativeBuffer.allocate(4);
  closed.close();
  return `${attempt(() => NativeBuffer.allocate(0).handle().release())} ${attempt(() => closed.handle().release())}`;
}

/** Two handles share the borrow, as reads do. */
export function shared(): string {
  const buffer = NativeBuffer.allocate(4);
  const a = buffer.handle();
  const b = buffer.handle();
  const both = `${a.pointer === b.pointer}`;
  a.release();
  const one = attempt(() => buffer.close());
  b.release();
  return `${both} ${one} ${attempt(() => buffer.close())}`;
}

/** Handed to JavaScript, which passes the pointer on and releases it. */
export function handleOf(buffer: NativeBuffer): NativeHandle {
  return buffer.handle();
}

export function pixels(size: number): NativeBuffer {
  return NativeBuffer.allocate(size);
}

/** From JavaScript: the same handle. */
export function describe(handle: NativeHandle): string {
  return `${handle.released} ${handle.pointer !== 0n}`;
}
