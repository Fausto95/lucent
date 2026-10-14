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

/**
 * Calls `handler` once, after `timeout` milliseconds (0 when missing,
 * negative or NaN), as a turn of the context that called it: the module's
 * actor, the main thread, an executor. Timers due at the same time run in
 * the order they were started. Returns the id clearTimeout takes. A
 * module's timers are cleared when its JavaScript runtime goes (a reload).
 */
declare function setTimeout(handler: () => void, timeout?: number): number;

/** Stops a timer setTimeout started, if it has not run. Any other id does nothing. */
declare function clearTimeout(id: number | undefined): void;

/** Calls `handler` every `timeout` milliseconds, as setTimeout does once, until cleared. */
declare function setInterval(handler: () => void, timeout?: number): number;

/** Stops an interval setInterval started. Any other id does nothing. */
declare function clearInterval(id: number | undefined): void;

/** Calls `callback` after the current turn's code and the microtasks queued before it. */
declare function queueMicrotask(callback: () => void): void;

/** What `encodeInto` did: the UTF-16 code units it read, and the bytes it wrote. */
interface TextEncoderEncodeIntoResult {
  read: number;
  written: number;
}

/** Encodes strings as UTF-8, a lone surrogate as U+FFFD. */
interface TextEncoder {
  /** Always "utf-8". */
  readonly encoding: string;
  encode(input?: string): Uint8Array<ArrayBuffer>;
  /** Writes the whole characters of `source` that fit in `destination`, from its start. */
  encodeInto(source: string, destination: Uint8Array): TextEncoderEncodeIntoResult;
}

declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

/** `fatal`: throw a TypeError on bytes that are not UTF-8, rather than decode them as U+FFFD. `ignoreBOM`: keep a leading byte order mark. */
interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

/** `stream`: more input follows, so a character the input ends inside of waits for it. */
interface TextDecodeOptions {
  stream?: boolean;
}

/**
 * Decodes UTF-8 bytes, as the Encoding standard does. In Lucent code the
 * label names UTF-8 ("utf-8", "utf8", …), the only encoding Lucent
 * decodes, and the options are written in the call.
 */
interface TextDecoder {
  /** Always "utf-8". */
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(
    input?: ArrayBufferLike | ArrayBufferView<ArrayBufferLike>,
    options?: TextDecodeOptions,
  ): string;
}

declare var TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};
