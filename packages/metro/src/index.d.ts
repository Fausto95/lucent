export interface LucentMetroOptions {
  /** Rebuild .lucent/native while the dev server runs (default: on for dev servers; LUCENT_WATCH=0/1 overrides). */
  watch?: boolean;
}

export declare function withLucent<T extends object>(config: T, options?: LucentMetroOptions): T;
