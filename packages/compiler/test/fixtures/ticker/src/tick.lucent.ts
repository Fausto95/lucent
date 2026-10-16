import { Ticker, ticker_count, ticker_keep } from "lucent:ext/ticker";

/** The integers from `from` to `to`, as the C library counts them: a callback for the call. */
export function counted(from: number, to: number): number[] {
  const out: number[] = [];
  ticker_count(from, to, (value) => out.push(value));
  return out;
}

/** How many names are longer than `length`: a callback's result. */
export function longer(names: string, length: number): number {
  return ticker_keep(names, (name) => name.length > length);
}

/** A ticker's ticks, as long as it lives: each tick runs during ticker_tick. */
export function ticked(times: number): string {
  using ticker = new Ticker();
  const seen: string[] = [];
  ticker.onTick((at) => seen.push(`tick ${at}`));
  for (let i = 0; i < times; i++) ticker.tick(i);
  return seen.join(", ");
}
