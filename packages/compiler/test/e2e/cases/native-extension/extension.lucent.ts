import { NativeBuffer } from "lucent:core";
import {
  OrbitFilter,
  orbit_filter_apply,
  orbit_filter_label,
  orbit_filter_live,
} from "lucent:ext/orbit-filter";

/** A Lucent class keeps the native handle: JavaScript uses the class. */
export class Filter {
  #native: OrbitFilter;

  constructor(strength: number) {
    this.#native = new OrbitFilter(strength);
  }

  apply(input: Uint8Array): Uint8Array {
    const output = new Uint8Array(input.length);
    const written = this.#native.apply(input, output);

    return output.subarray(0, written);
  }

  processed(): bigint {
    return this.#native.processed();
  }

  close(): void {
    this.#native.close();
  }
}

/** How many native filters exist. */
export function live(): number {
  return orbit_filter_live();
}

/** A string crosses as UTF-8: its length in bytes. */
export function labelBytes(name: string): number {
  return orbit_filter_label(name);
}

/** The error C reports for a short output, and the filter still works after it. */
export function shortOutput(): string {
  const f = new OrbitFilter(1);

  try {
    orbit_filter_apply(f, new Uint8Array(4), new Uint8Array(2));
    return "no error";
  } catch (e) {
    return `${(e as Error).message}; then ${f.apply(new Uint8Array([7]), new Uint8Array(1))}`;
  } finally {
    f.close();
  }
}

/** A using declaration closes the handle when its block ends, and every use after throws. */
export function scoped(): string {
  const before = orbit_filter_live();
  let kept: OrbitFilter | undefined;

  {
    using f = new OrbitFilter(2);
    kept = f;
    f.apply(new Uint8Array([1, 2, 3]), new Uint8Array(3));
  }

  const after = orbit_filter_live() - before;

  try {
    kept.processed();
    return `${after}: no error`;
  } catch (e) {
    return `${after}: ${(e as Error).name}: ${(e as Error).message}`;
  }
}

/** Closing twice destroys once. */
export function closeTwice(): number {
  const before = orbit_filter_live();
  const f = new OrbitFilter(1);

  f.close();
  f.close();

  return orbit_filter_live() - before;
}

/** An ArrayBuffer's and a NativeBuffer's own bytes (decision 0130): the buffer borrowed for the call. */
export function borrowed(): string {
  const f = new OrbitFilter(2);
  const input = NativeBuffer.from(new Uint8Array([1, 2, 3]));
  const output = new ArrayBuffer(3);
  const written = f.apply(input, output);
  const scaled = Array.from(new Uint8Array(output)).join(",");

  // Into a NativeBuffer, from a Uint8Array: written in place.
  const into = NativeBuffer.allocate(2);
  f.apply(new Uint8Array([5, 6]), into);
  const back = into.withRead((bytes) => `${bytes[0]},${bytes[1]}`);

  // A buffer being written can't be borrowed to read: refused before the call.
  let refused = "";
  input.withWrite(() => {
    try {
      f.apply(input, output);
    } catch (e) {
      refused = (e as Error).name;
    }
  });

  input.close();
  into.close();
  let closed = "";
  try {
    f.apply(input, output);
  } catch (e) {
    closed = (e as Error).name;
  }
  f.close();
  return `${written} ${scaled} ${back} ${refused} ${closed}`;
}
