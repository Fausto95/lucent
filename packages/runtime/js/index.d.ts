/** What lucent build compiled: the runtime ABI, each target's program and each module's API. */
export interface BuildIdentity {
  runtimeAbi: number;
  programs: Record<string, string>;
  apis: Record<string, Record<string, string>>;
}
/**
 * Returns the exports object of a compiled Lucent module, after checking
 * the app's native code against `expected`.
 */
export declare function loadModule(
  name: string,
  registry: () => { get(name: string): unknown },
  expected?: BuildIdentity,
): Record<string, unknown>;
/** Wraps a native class factory in a constructor usable with `new`. */
export declare function lucentClass<T>(factory: T): T;
