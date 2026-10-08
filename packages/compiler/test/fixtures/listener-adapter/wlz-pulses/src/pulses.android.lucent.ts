import { fromCallback, subscribe } from "lucent:core";
import type { Exception } from "lucent:android/java.lang";
import { Orb, type PulseListener } from "lucent:android/dev.wlz.orb";

/** Hands the orb's pulses and failures to Lucent functions. */
class Relay implements PulseListener {
  private readonly pulse: (level: number) => void;
  private readonly failure: (error: Error) => void;

  constructor(pulse: (level: number) => void, failure: (error: Error) => void) {
    this.pulse = pulse;
    this.failure = failure;
  }

  onPulse(level: number): void {
    this.pulse(level);
  }

  onFailure(error: Exception | null): void {
    this.failure(new Error(error?.getMessage() ?? "the orb failed"));
  }
}

/** One pulse: the listener is detached as soon as it settles. */
function nextPulse(orb: Orb, signal?: AbortSignal): Promise<number> {
  return fromCallback<number>((resolve, reject) => {
    const hook = orb.attach(new Relay(resolve, reject));
    return () => hook?.detach();
  }, signal);
}

/** Every pulse, to `onLevel`, until the orb breaks or the signal aborts. */
function watchPulses(
  orb: Orb,
  onLevel: (level: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return subscribe<number>(
    (next, _end, fail) => {
      const hook = orb.attach(new Relay(next, fail));
      return () => hook?.detach();
    },
    onLevel,
    signal,
  );
}

export async function firstPulse(emitted: number, signal?: AbortSignal): Promise<number> {
  const orb = new Orb("first");
  const level = nextPulse(orb, signal);

  orb.emitPulses(emitted, false);
  return await level;
}

export async function pulsesUntilBroken(emitted: number): Promise<string> {
  const orb = new Orb("broken");
  const levels: number[] = [];
  const watching = watchPulses(orb, (level) => levels.push(level));

  orb.emitPulses(emitted, true);
  try {
    await watching;
    return "ended";
  } catch (e) {
    return `${levels.join(" ")}; ${(e as Error).message}; attached ${orb.attachedCount()}`;
  }
}

export async function pulsesUntilAborted(stopAt: number): Promise<string> {
  const orb = new Orb("aborted");
  const levels: number[] = [];
  const controller = new AbortController();
  const watching = watchPulses(
    orb,
    (level) => {
      levels.push(level);
      if (level === stopAt) controller.abort();
    },
    controller.signal,
  );

  orb.emitPulses(stopAt + 5, false);
  // An abort ends the subscription: it resolves, as a stopped watch does.
  try {
    await watching;
    return `${levels.join(" ")}; ended; attached ${orb.attachedCount()}`;
  } catch (e) {
    return `${levels.join(" ")}; ${(e as Error).name}; attached ${orb.attachedCount()}`;
  }
}
