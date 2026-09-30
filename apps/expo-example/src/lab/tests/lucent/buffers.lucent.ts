import { compute, NativeBuffer, type NativeBufferStats } from "lucent:core";

// The scan a task runs over a buffer it owns: `using` closes it after.
function scan(buffer: NativeBuffer): number {
  using owned = buffer;

  return owned.withRead((bytes) => {
    let total = 0;

    for (let i = 0; i < bytes.length; i++) total += bytes[i]!;

    return total;
  });
}

/** Fills a buffer, then hands it to a task without copying its bytes. */
export async function sample(): Promise<number> {
  const buffer = NativeBuffer.allocate(4096);

  buffer.withWrite((bytes) => bytes.fill(7));

  return await compute(scan, buffer.transfer());
}

export function make(bytes: Uint8Array): NativeBuffer {
  return NativeBuffer.from(bytes);
}

export function echo(buffer: NativeBuffer): NativeBuffer {
  return buffer;
}

export function total(buffer: NativeBuffer): number {
  return buffer.withRead((bytes) => {
    let sum = 0;

    for (let i = 0; i < bytes.length; i++) sum += bytes[i]!;

    return sum;
  });
}

/** Doubles every byte in place; values wrap as in a Uint8Array. */
export function double(buffer: NativeBuffer): void {
  buffer.withWrite((bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i]! * 2;
  });
}

function failure(e: Error): string {
  return `${e.name}: ${e.message}`;
}

/** A span reads and writes like a Uint8Array. */
export function spans(): string {
  const buffer = NativeBuffer.allocate(6);

  buffer.withWrite((bytes) => {
    bytes[0] = 258;
    bytes[1] = -1;
    bytes[9] = 5;
    bytes[2]! += 7;
    bytes.fill(4, 3);
    bytes.fill(8, -2, -1);
  });

  const read = buffer.withRead((bytes) => `${bytes.length} ${bytes[0]} ${bytes[9]}`);

  buffer.withWrite((bytes) => bytes.set(new Uint8Array([9, 9]), 4));

  let outOfBounds = "";

  try {
    buffer.withWrite((bytes) => bytes.set(new Uint8Array([1, 2]), 5));
  } catch (e) {
    outOfBounds = (e as Error).name;
  }

  return `${read} ${buffer.toUint8Array().join(",")} ${outOfBounds}`;
}

/** Snapshots and copies in are independent of the buffer. */
export function snapshots(): string {
  const source = new Uint8Array([1, 2, 3]);
  const buffer = NativeBuffer.from(source);

  source[0] = 50;

  const snapshot = buffer.toUint8Array();

  buffer.withWrite((bytes) => bytes.fill(0));
  snapshot[1] = 60;

  return `${snapshot.join(",")} ${buffer.toUint8Array().join(",")} ${source.join(",")}`;
}

export function sizes(): string {
  const out: string[] = [`${NativeBuffer.allocate(0).byteLength}`];

  for (const size of [-1, 1.5, Number.NaN]) {
    try {
      NativeBuffer.allocate(size);
    } catch (e) {
      out.push(failure(e as Error));
    }
  }

  return out.join("; ");
}

/** A borrow refuses what would conflict with it; reads nest. */
export function conflicts(): string {
  const buffer = NativeBuffer.allocate(4);
  const out: string[] = [];

  buffer.withRead(() => {
    try {
      buffer.withWrite((bytes) => bytes.fill(1));
    } catch (e) {
      out.push(failure(e as Error));
    }

    try {
      buffer.transfer();
    } catch (e) {
      out.push(failure(e as Error));
    }

    try {
      buffer.close();
    } catch (e) {
      out.push(failure(e as Error));
    }

    out.push(`nested ${buffer.withRead((bytes) => bytes.length)}`);
  });

  buffer.withWrite(() => {
    try {
      buffer.toUint8Array();
    } catch (e) {
      out.push(failure(e as Error));
    }
  });

  return out.join("; ");
}

/** Every alias of a transferred buffer refuses use; the new handle owns the bytes. */
export function aliases(): string {
  const buffer = NativeBuffer.from(new Uint8Array([1, 2, 3]));
  const alias = buffer;
  const moved = buffer.transfer();
  const out: string[] = [`${alias.byteLength} ${moved.byteLength}`];

  try {
    alias.withRead((bytes) => bytes.length);
  } catch (e) {
    out.push(failure(e as Error));
  }

  try {
    alias.transfer();
  } catch (e) {
    out.push(failure(e as Error));
  }

  alias.close();
  out.push(`${total(moved)}`);

  moved.close();
  moved.close();

  try {
    moved.toUint8Array();
  } catch (e) {
    out.push(failure(e as Error));
  }

  return out.join("; ");
}

/** A buffer handed to a task leaves the sender's aliases refusing it. */
export async function handoff(): Promise<string> {
  const buffer = NativeBuffer.allocate(8);
  const alias = buffer;

  buffer.withWrite((bytes) => bytes.fill(3));

  const sum = await compute(scan, buffer);
  let after = "";

  try {
    alias.withRead((bytes) => bytes.length);
  } catch (e) {
    after = failure(e as Error);
  }

  return `${sum} ${alias.byteLength} ${after}`;
}

/** A borrowed buffer does not move: the task is refused, the buffer stays. */
export async function borrowedHandoff(): Promise<string> {
  const buffer = NativeBuffer.allocate(4);
  let pending: Promise<number> | undefined;

  buffer.withRead(() => {
    pending = compute(scan, buffer);
  });

  try {
    return `ran ${await pending!}`;
  } catch (e) {
    return `${failure(e as Error)}; still ${buffer.byteLength}`;
  }
}

type Job = { buffer: NativeBuffer; scale: number };

function scaled(job: Job): number {
  return scan(job.buffer) * job.scale;
}

function filled(size: number): NativeBuffer {
  const buffer = NativeBuffer.allocate(size);

  buffer.withWrite((bytes) => bytes.fill(3));

  return buffer;
}

/** Buffers inside an input move with it, and a task's buffer comes back as it is. */
export async function inputs(): Promise<string> {
  const buffer = NativeBuffer.allocate(3);
  const alias = buffer;

  buffer.withWrite((bytes) => bytes.fill(2));

  const scaledSum = await compute(scaled, { buffer, scale: 10 });
  const made = await compute(filled, 5);

  return `${scaledSum} ${alias.byteLength} ${made.byteLength} ${total(made)}`;
}

function sumBytes(bytes: Uint8Array): number {
  let sum = 0;

  for (let i = 0; i < bytes.length; i++) sum += bytes[i]!;

  return sum;
}

function since(before: NativeBufferStats): string {
  const now = NativeBuffer.stats();

  return `${now.copies - before.copies} copies, ${now.bytesCopied - before.bytesCopied} bytes, ${now.transfers - before.transfers} transfers`;
}

/**
 * What the two ways to get `size` bytes to a task cost: a handoff moves the
 * buffer; a snapshot copies it out to a Uint8Array and back into a buffer.
 */
export async function copies(size: number): Promise<string> {
  const handed = NativeBuffer.allocate(size);

  handed.withWrite((bytes) => bytes.fill(1));

  const beforeHandoff = NativeBuffer.stats();
  const handedSum = await compute(scan, handed);
  const handoffCost = since(beforeHandoff);

  const kept = NativeBuffer.allocate(size);

  kept.withWrite((bytes) => bytes.fill(1));

  const beforeSnapshot = NativeBuffer.stats();
  const snapshot = kept.toUint8Array();
  const snapshotSum = await compute(sumBytes, snapshot);
  const back = NativeBuffer.from(snapshot);
  const snapshotCost = since(beforeSnapshot);

  return `${size}: handoff ${handedSum} (${handoffCost}); snapshot ${snapshotSum} (${snapshotCost}) ${back.byteLength}`;
}

/** Chunks streamed to tasks one after another: none is copied. */
export async function stream(chunks: number, size: number): Promise<string> {
  const before = NativeBuffer.stats();
  let sum = 0;

  for (let i = 0; i < chunks; i++) {
    const chunk = NativeBuffer.allocate(size);

    chunk.withWrite((bytes) => bytes.fill(i));
    sum += await compute(scan, chunk);
  }

  return `${sum} (${since(before)})`;
}

/** Spans and buffers print, stringify and compare as a Uint8Array and an object do. */
export function texts(): string {
  const buffer = NativeBuffer.from(new Uint8Array([1, 2]));
  const spans = buffer.withRead((bytes) => `${bytes} ${JSON.stringify(bytes)}`);
  const same = buffer.withRead((a) => buffer.withRead((b) => a === b));

  return `${spans} ${same} ${buffer === NativeBuffer.from(new Uint8Array(0))} ${JSON.stringify({ buffer })} ${buffer} ${typeof buffer}`;
}
