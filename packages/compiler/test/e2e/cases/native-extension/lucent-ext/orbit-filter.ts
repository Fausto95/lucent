// What lucent:ext/orbit-filter does, in JavaScript: the reference run of the
// native-extension case compares the C++ filter against it.
let live = 0;

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

  apply(input: Uint8Array, output: Uint8Array): number {
    this.#check();
    if (output.length < input.length) throw failure("output is shorter than input", "2");

    for (let i = 0; i < input.length; i++)
      output[i] = Math.min(255, Math.floor(input[i]! * this.#strength + 0.5));

    this.#processed += BigInt(input.length);
    return input.length;
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
