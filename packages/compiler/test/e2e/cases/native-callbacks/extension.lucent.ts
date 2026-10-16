// A C library's callbacks (decisions 0126 and 0128): Lucent functions C
// calls during the call, once later, as long as a handle lives, and from
// another thread, each run on the module's context.
import {
  Ticker,
  ticker_check,
  ticker_count,
  ticker_count_threaded,
  ticker_flush,
  ticker_keep,
  ticker_later,
  ticker_recall,
} from "lucent:ext/ticker";

/** During the call, at once and in order; a later call of it does nothing. */
export function counted(): string {
  const out: number[] = [];
  ticker_count(1, 4, (value) => out.push(value));
  ticker_recall();
  return out.join(",");
}

/** A result C gets, from strings and bigints C passed. */
export function kept(): string {
  const seen: string[] = [];
  const n = ticker_keep("ab,c,,déf", (name, index) => {
    seen.push(`${index}:${name}`);
    return name.length > 1;
  });
  return `${n} ${seen.join(" ")}`;
}

/** Once: C calls it twice, and only the first runs. */
export function once(): string {
  const out: number[] = [];
  ticker_later(21, (doubled) => out.push(doubled));
  ticker_later(5, (doubled) => out.push(doubled));
  const before = out.length;
  ticker_flush();
  return `${before} ${out.join(",")}`;
}

/** As long as a handle lives: at once during each later call that ticks it. */
export function ticks(): string {
  const seen: string[] = [];
  const ticker = new Ticker();
  ticker.onTick((at) => seen.push(`a${at}`));
  ticker.onTick((at) => seen.push(`b${at}`));
  const called = ticker.tick(1) + ticker.tick(2);
  ticker.close();
  return `${called} ${seen.join(" ")}`;
}

/** What a callback throws, C gets zero for, and the call throws once it returns. */
export function throws(): string {
  const out: string[] = [];
  try {
    ticker_count(1, 3, (value) => {
      out.push(`v${value}`);
      if (value === 2) throw new RangeError(`no ${value}`);
    });
  } catch (e) {
    out.push(`${(e as Error).name}: ${(e as Error).message}`);
  }
  return out.join(" ");
}

/** With an error struct: what the callback threw comes first. */
export function checked(): string {
  const out: string[] = [];
  out.push(String(ticker_check(3, (v) => v > 0)));
  try {
    ticker_check(1, () => {
      throw new Error("from the callback");
    });
  } catch (e) {
    out.push((e as Error).message);
  }
  return out.join(" | ");
}

/** C's failure, with its code: JavaScript reads it. */
export function failed(): number {
  return ticker_check(-3, (v) => v > 0);
}

const posted: number[] = [];

/** From another thread: posted to the module's context, run after the call, in order. */
export function threaded(): string {
  posted.length = 0;
  ticker_count_threaded(1, 3, (value) => posted.push(value));
  return `during ${posted.length}`;
}

/** What the posted calls did, once they ran. */
export function afterwards(): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve(posted.join(",")), 20));
}
