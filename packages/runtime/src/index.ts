/**
 * The JavaScript side of Lucent: what generated proxies import. Kept tiny and
 * host-agnostic so Expo and Nitro modules present the same surface to app code.
 */

/** Error thrown by native Lucent code. `code` is the first argument of `throw new LucentError(...)`. */
export class LucentError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "LucentError";
    this.code = code;
  }
}

/** Nitro prefixes native errors with the call: "Math.divide(...): [CODE] message". */
const NITRO_PREFIX = /^(?:[A-Za-z0-9_]+\.[A-Za-z0-9_]+\(\.\.\.\): )?\[([A-Za-z0-9_]+)\] ?/;
/** Expo decorates thrown exceptions as "LucentError: <reason> (at File.swift:12)". */
const EXPO_DECORATION = /^LucentError: (.*?)(?: \(at [^)]*\))?$/s;
const EXPO_CAUSED_BY = /→ Caused by: (?:[A-Za-z]+: )?/;

/** Turns whatever a host threw into a LucentError, preserving the code. */
export function normalizeError(error: unknown): LucentError {
  if (error instanceof LucentError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined;
  // Expo wraps native throws: "FunctionCallException: Calling the 'x' function has failed\n→ Caused by: <message>".
  const expoParts = raw.split(EXPO_CAUSED_BY);
  const causedBy = expoParts.length > 1 ? expoParts[expoParts.length - 1]!.trim() : raw;
  const unwrapped = EXPO_DECORATION.exec(causedBy)?.[1] ?? causedBy;
  // Nitro delivers only a message: "[CODE] message".
  const nitro = NITRO_PREFIX.exec(unwrapped);
  if (nitro) return new LucentError(nitro[1]!, unwrapped.slice(nitro[0].length));
  return new LucentError(code ?? "UNKNOWN", unwrapped);
}

/** Runs a native call and rethrows failures as LucentError, for sync and promise-returning calls alike. */
export function lucentCall<T>(fn: () => T): T {
  let result: T;
  try {
    result = fn();
  } catch (error) {
    throw normalizeError(error);
  }
  if (result instanceof Promise) {
    return result.catch((error: unknown) => {
      throw normalizeError(error);
    }) as T;
  }
  return result;
}

/** A Uint8Array's bytes as an ArrayBuffer without copying when the view covers its whole buffer. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export function fromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}
