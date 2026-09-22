// Globals available to Lucent modules beyond the ES2022 library. Only the
// Lucent compiler loads this file; React Native, Node and the DOM declare
// compatible versions, so the same source type-checks in an app's editor.

interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  debug(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

declare var console: Console;
