// What lucent:ext/orbit-filter does, in JavaScript: the reference run of the
// native-extension case compares the C++ filter against it.
let live = 0;

/** What a bytes parameter takes (decision 0130): a NativeBuffer is borrowed, the rest used in place. */
type Bytes = Uint8Array | ArrayBuffer | Borrowable;

interface Borrowable {
  withRead<R>(read: (bytes: Uint8Array) => R): R;
  withWrite<R>(write: (bytes: Uint8Array) => R): R;
}

function lend<R>(b: Bytes, write: boolean, f: (bytes: Uint8Array) => R): R {
  if (b instanceof Uint8Array) return f(b);
  if (b instanceof ArrayBuffer) return f(new Uint8Array(b));
  return write ? b.withWrite(f) : b.withRead(f);
}

function failure(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

export class OrbitFilter {
  #strength: number;
  #processed = 0n;
  #open = true;

  constructor(strength: number) {
    if (!(strength >= 0 && strength <= 4)) throw failure("strength must be between 0 and 4", "1");

    this.#strength = strength;
    live++;
  }

  apply(input: Bytes, output: Bytes): number {
    this.#check();
    // As the call borrows them: the input to read, then the output to write.
    return lend(input, false, (inBytes) =>
      lend(output, true, (outBytes) => {
        if (outBytes.length < inBytes.length) throw failure("output is shorter than input", "2");

        for (let i = 0; i < inBytes.length; i++)
          outBytes[i] = Math.min(255, Math.floor(inBytes[i]! * this.#strength + 0.5));

        this.#processed += BigInt(inBytes.length);
        return inBytes.length;
      }),
    );
  }

  processed(): bigint {
    this.#check();
    return this.#processed;
  }

  close(): void {
    if (!this.#open) return;

    this.#open = false;
    live--;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #check(): void {
    if (this.#open) return;

    const e = new Error("OrbitFilter is closed");
    e.name = "InvalidStateError";
    throw e;
  }
}

export function orbit_filter_apply(f: OrbitFilter, input: Uint8Array, output: Uint8Array): number {
  return f.apply(input, output);
}

export function orbit_filter_live(): number {
  return live;
}

export function orbit_filter_label(name: string): number {
  return new TextEncoder().encode(name).length;
}
