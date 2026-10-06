import { PLATFORM } from "lucent:platform";
import { Ticker } from "lucent:android/dev.orbit.ticker";
import { type Flow, FlowKt } from "lucent:android/kotlinx.coroutines.flow";
import { delay, subscribe } from "lucent:core";

const NONE = "no Kotlin on iOS";

/** Every value of a flow that completes, in order, then the first of another. */
export async function flowValues(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const ticker = new Ticker();
    const seen: number[] = [];
    await ticker.count(3, 5n).collect((n) => {
      seen.push(n);
    });

    return `${seen.join(",")} ${await FlowKt.first(ticker.count(2))} ${(await FlowKt.toList(ticker.count(4))).length}`;
  }
}

/** A flow's error, after the values before it; and a collector's own error, as itself. */
export async function flowErrors(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const ticker = new Ticker();
    const seen: string[] = [];
    let failed = "";
    try {
      await ticker.failing("one").collect((s) => {
        seen.push(s);
      });
    } catch (e) {
      failed = (e as Error).message;
    }

    let thrown = "";
    try {
      await ticker.count(5).collect((n) => {
        if (n === 2) throw new RangeError(`stop at ${n}`);
      });
    } catch (e) {
      thrown = `${(e as Error).name}: ${(e as Error).message}`;
    }

    return `${seen.join(",")} | ${failed} | ${thrown}`;
  }
}

/** A flow that never ends, cancelled by its signal: the promise rejects, and the flow stops. */
export async function flowCancel(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const ticker = new Ticker();
    const controller = new AbortController();
    let ticks = 0;
    let outcome = "completed";
    try {
      await ticker.forever(5n).collect(() => {
        if (++ticks === 3) controller.abort();
      }, controller.signal);
    } catch (e) {
      outcome = (e as Error).name;
    }

    // The coroutine stops at its next suspension point.
    for (let i = 0; i < 100 && ticker.cancelled === 0; i++) await delay(10);
    const counted = ticks;
    await delay(50);

    return `${outcome} ${counted} ${ticks === counted} ${ticker.cancelled}`;
  }
}

/** A state flow: its current value first, then each change, until cancelled. */
export async function flowState(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const ticker = new Ticker();
    const controller = new AbortController();
    const seen: string[] = [];
    const collecting = ticker.state.collect((label) => {
      seen.push(label);
      if (label === "done") controller.abort();
    }, controller.signal);

    for (let i = 0; i < 100 && seen.length === 0; i++) await delay(10);
    ticker.label("busy");
    for (let i = 0; i < 100 && seen.length < 2; i++) await delay(10);
    ticker.label("done");

    let outcome = "completed";
    try {
      await collecting;
    } catch (e) {
      outcome = (e as Error).name;
    }
    return `${seen.join(",")} ${outcome}`;
  }
}

/** Suspend functions taking suspend functions: each step runs while Kotlin waits. */
export async function suspendArguments(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const ticker = new Ticker();
    const steps: string[] = [];
    const n = await ticker.each(["a", "b", "c"], (s) => {
      steps.push(s);
    });
    const up = await ticker.transformed("orbit", (s) => s.toUpperCase());

    return `${n} ${steps.join("")} ${up}`;
  }
}

/** Collects `flow` into a subscription's callbacks: its end or its error settles it. */
async function collectInto(
  flow: Flow<number>,
  next: (n: number) => void,
  end: () => void,
  fail: (error: Error) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    await flow.collect(next, signal);
    end();
  } catch (e) {
    fail(e as Error);
  }
}

/** `flow` as a lucent:core subscription, whose cleanup cancels the collection. */
function subscribed(
  flow: Flow<number>,
  onValue: (n: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return subscribe<number>(
    (next, end, fail) => {
      const collecting = new AbortController();
      void collectInto(flow, next, end, fail, collecting.signal);
      return () => collecting.abort();
    },
    onValue,
    signal,
  );
}

/**
 * Flows as subscriptions: one that completes gives its values, then ends
 * the subscription; one that never ends stops when its subscription's
 * signal aborts, and the cleanup cancels its coroutine.
 */
export async function flowSubscribed(): Promise<string> {
  if (PLATFORM === "ios") {
    return NONE;
  } else {
    const ticker = new Ticker();
    const seen: number[] = [];
    await subscribed(ticker.count(3), (n) => {
      seen.push(n);
    });

    const controller = new AbortController();
    let ticks = 0;
    let outcome = "completed";
    try {
      await subscribed(
        ticker.forever(5n),
        () => {
          if (++ticks === 3) controller.abort();
        },
        controller.signal,
      );
    } catch (e) {
      outcome = (e as Error).name;
    }

    // The coroutine stops at its next suspension point.
    for (let i = 0; i < 100 && ticker.cancelled === 0; i++) await delay(10);

    return `${seen.join(",")} ${outcome} ${ticks} ${ticker.cancelled}`;
  }
}
