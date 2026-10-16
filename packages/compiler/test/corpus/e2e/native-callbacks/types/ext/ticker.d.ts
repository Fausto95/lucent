// lucent:ext/ticker: lucent-ticker's native extension (generated from its header and lucent.json)
/**
 * A handle of lucent-ticker's native extension, made by ticker_create; close() destroys it, once.
 */
export declare class Ticker {
  /** ticker_create */
  constructor();
  /** ticker_on_tick */
  onTick(tick: (arg0: number) => void): void;
  /** ticker_tick */
  tick(at: number): number;
  /** Destroys it; later uses throw. Closing again does nothing. */
  close(): void;
  /** close() */
  [Symbol.dispose](): void;
}
export declare function ticker_count(from: number, to: number, visit: (arg0: number) => void): void;
export declare function ticker_recall(): void;
export declare function ticker_keep(names: string, keep: (arg0: string, arg1: bigint) => boolean): number;
export declare function ticker_later(value: number, done: (arg0: number) => void): void;
export declare function ticker_flush(): void;
export declare function ticker_create(): Ticker;
export declare function ticker_on_tick(ticker: Ticker, tick: (arg0: number) => void): void;
export declare function ticker_tick(ticker: Ticker, at: number): number;
export declare function ticker_count_threaded(from: number, to: number, visit: (arg0: number) => void): void;
export declare function ticker_check(value: number, ok: (arg0: number) => boolean): number;
