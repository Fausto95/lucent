// lucent:ext/orbit-filter: lucent-orbit-filter's native extension (generated from its header and lucent.json)
import type { NativeBuffer } from "lucent:core";
/**
 * A handle of lucent-orbit-filter's native extension, made by orbit_filter_create; close() destroys it, once.
 */
export declare class OrbitFilter {
  /** orbit_filter_create */
  constructor(strength: number);
  /** orbit_filter_apply */
  apply(input: Uint8Array | ArrayBuffer | NativeBuffer, output: Uint8Array | ArrayBuffer | NativeBuffer): number;
  /** orbit_filter_processed */
  processed(): bigint;
  /** Destroys it; later uses throw. Closing again does nothing. */
  close(): void;
  /** close() */
  [Symbol.dispose](): void;
}
export declare function orbit_filter_create(strength: number): OrbitFilter;
export declare function orbit_filter_apply(filter: OrbitFilter, input: Uint8Array | ArrayBuffer | NativeBuffer, output: Uint8Array | ArrayBuffer | NativeBuffer): number;
export declare function orbit_filter_processed(filter: OrbitFilter): bigint;
export declare function orbit_filter_live(): number;
export declare function orbit_filter_label(name: string): number;

// Not bound:
//   orbit_filter_each: parameter visit is a function pointer: declare it in params as a callback, with its context
