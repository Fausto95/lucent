// Globals available to Lucent modules beyond the ES2022 library. Only the
// Lucent compiler loads this file; React Native, Node and the DOM declare
// compatible versions, so the same source type-checks in an app's editor.

/**
 * What `console` logs. On iOS each line goes to the unified log, prefixed
 * `[Lucent]`; on Android, to logcat under the tag `Lucent`. An object
 * prints as `String(obj)`.
 */
interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  debug(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

declare var console: Console;

/**
 * The signal of an `AbortController`, which JavaScript passes to cancel an
 * async call. Lucent code checks it, waits on it, or passes it on.
 */
interface AbortSignal {
  readonly aborted: boolean;
  /** Not available in Lucent code: catch the error from throwIfAborted() or delay() instead. */
  readonly reason: any;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void): void;
}

declare var AbortSignal: {
  prototype: AbortSignal;
};

/** Makes a signal, and aborts it. */
interface AbortController {
  readonly signal: AbortSignal;
  /** In Lucent code, `reason` must be an Error. */
  abort(reason?: any): void;
}

declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};
