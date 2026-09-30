import { fromCallback, subscribe } from "lucent:core";
import { WLZOrb } from "lucent:ios/WLZOrb";

/** One pulse: the listener is detached as soon as it settles. */
function nextPulse(orb: WLZOrb, signal?: AbortSignal): Promise<number> {
  return fromCallback<number>((resolve, reject) => {
    const hook = orb.attachPulse(resolve, reject);
    return () => hook.detach();
  }, signal);
}

/** Every pulse, to `onLevel`, until the orb breaks or the signal aborts. */
function watchPulses(
  orb: WLZOrb,
  onLevel: (level: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return subscribe<number>(
    (next, _end, fail) => {
      const hook = orb.attachPulse(next, fail);
      return () => hook.detach();
    },
    onLevel,
    signal,
  );
}

export async function firstPulse(emitted: number, signal?: AbortSignal): Promise<number> {
  const orb = new WLZOrb("first");
  const level = nextPulse(orb, signal);

  orb.emitPulses(emitted, false);
  return await level;
}

export async function pulsesUntilBroken(emitted: number): Promise<string> {
  const orb = new WLZOrb("broken");
  const levels: number[] = [];
  const watching = watchPulses(orb, (level) => levels.push(level));

  orb.emitPulses(emitted, true);
  try {
    await watching;
    return "ended";
  } catch (e) {
    return `${levels.join(" ")}; ${(e as Error).message}; attached ${orb.attachedCount}`;
  }
}

export async function pulsesUntilAborted(stopAt: number): Promise<string> {
  const orb = new WLZOrb("aborted");
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
  try {
    await watching;
    return "ended";
  } catch (e) {
    return `${levels.join(" ")}; ${(e as Error).name}; attached ${orb.attachedCount}`;
  }
}
