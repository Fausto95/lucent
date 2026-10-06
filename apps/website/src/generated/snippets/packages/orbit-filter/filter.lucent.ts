import { OrbitFilter, orbit_filter_label, orbit_filter_live } from "lucent:ext/orbit-filter";

/** Scales bytes by a strength, with the native Orbit filter. */
export class Filter {
  #native: OrbitFilter;

  constructor(strength: number) {
    this.#native = new OrbitFilter(strength);
  }

  /** The scaled bytes. */
  apply(input: Uint8Array): Uint8Array {
    const output = new Uint8Array(input.length);
    const written = this.#native.apply(input, output);

    return output.subarray(0, written);
  }

  /** How many bytes it has scaled. */
  processed(): bigint {
    return this.#native.processed();
  }

  /** Releases the native filter; later uses throw. */
  close(): void {
    this.#native.close();
  }
}

/** How many native filters exist. */
export function liveFilters(): number {
  return orbit_filter_live();
}

/** A label's length in UTF-8 bytes, measured natively. */
export function labelBytes(name: string): number {
  return orbit_filter_label(name);
}
