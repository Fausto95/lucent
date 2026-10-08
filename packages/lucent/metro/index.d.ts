export interface LucentMetroOptions {
  /** Rebuild .lucent/native while the dev server runs (default: on for dev servers; LUCENT_WATCH=0/1 overrides). */
  watch?: boolean;
  /**
   * JS dev mode: bundle each `*.lucent.ts` module as JavaScript, so edits refresh
   * without a native rebuild; platform SDK calls throw LUCENT_JS_DEV_NATIVE, and
   * `.lucent.tsx` modules stay native. Development builds only (default: LUCENT_JS=1).
   */
  js?: boolean;
}

export declare function withLucent<T extends object>(config: T, options?: LucentMetroOptions): T;
