/** Returns the exports object of a compiled Lucent module. */
export declare function loadModule(name: string): Record<string, unknown>;
/** Wraps a native class factory in a constructor usable with `new`. */
export declare function lucentClass<T>(factory: T): T;
