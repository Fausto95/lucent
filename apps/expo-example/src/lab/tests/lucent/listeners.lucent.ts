import { delay, fromCallback, subscribe } from "lucent:core";

type Listener = { id: number; onLevel: (level: number) => void; onError: (e: Error) => void };

/** A listener API that knows nothing of promises, standing in for a native one. */
class Pulses {
  private listeners: Listener[] = [];
  private nextId = 1;
  private readonly log: string[];

  constructor(log: string[]) {
    this.log = log;
  }

  listen(onLevel: (level: number) => void, onError: (e: Error) => void): number {
    const id = this.nextId++;

    this.listeners.push({ id, onLevel, onError });
    this.log.push(`listen ${id}`);
    return id;
  }

  remove(id: number): void {
    this.listeners = this.listeners.filter((l) => l.id !== id);
    this.log.push(`remove ${id}`);
  }

  /** Reports `level` to every listener, even after they asked to stop. */
  emit(level: number, stale: Listener[] = []): void {
    for (const l of [...this.listeners, ...stale]) l.onLevel(level);
  }

  /** Removing a listener replaces the array: this one stays as it was. */
  fail(message: string): void {
    for (const l of this.listeners) l.onError(new Error(message));
  }

  snapshot(): Listener[] {
    return [...this.listeners];
  }
}

function nextLevel(pulses: Pulses, signal?: AbortSignal): Promise<number> {
  return fromCallback<number>((resolve, reject) => {
    const id = pulses.listen(resolve, reject);
    return () => pulses.remove(id);
  }, signal);
}

/** An AbortError's message depends on the engine (docs/semantics.md): left out. */
function rejected(e: Error): string {
  return e.name === "AbortError" ? `rejected ${e.name}` : `rejected ${e.name}: ${e.message}`;
}

async function outcome(p: Promise<number>): Promise<string> {
  try {
    return `resolved ${await p}`;
  } catch (e) {
    return rejected(e as Error);
  }
}

async function ending(p: Promise<void>): Promise<string> {
  try {
    await p;
    return "ended";
  } catch (e) {
    return rejected(e as Error);
  }
}

export async function settlesOnce(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);
  const p = nextLevel(pulses);
  const stale = pulses.snapshot();

  await delay(1);
  pulses.emit(3);
  log.push("emitted");
  // A native listener may still report after it was removed: dropped.
  pulses.emit(4, stale);
  pulses.fail("late");
  log.push(await outcome(p));
  return log.join(", ");
}

export async function completesDuringRegistration(): Promise<string> {
  const log: string[] = [];
  const p = fromCallback<string>((resolve) => {
    resolve("now");
    log.push("resolved");
    resolve("again");
    return () => log.push("cleanup");
  });

  log.push("returned");
  log.push(`awaited ${await p}`);
  return log.join(", ");
}

/** A registration made elsewhere, typed by its own declaration. */
function listenTo(
  pulses: Pulses,
): (resolve: (level: number) => void, reject: (e: Error) => void) => () => void {
  return (resolve, reject) => {
    const id = pulses.listen(resolve, reject);
    return () => pulses.remove(id);
  };
}

export async function namedRegistration(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);
  const p = fromCallback(listenTo(pulses));

  pulses.emit(6);
  log.push(await outcome(p));
  return log.join(", ");
}

export async function registrationThrows(): Promise<string> {
  const log: string[] = [];
  const thrown = fromCallback<number>(() => {
    log.push("registering");
    throw new RangeError("no listener");
  });
  const afterResolve = fromCallback<number>((resolve) => {
    resolve(1);
    throw new RangeError("ignored");
  });

  log.push(await outcome(thrown));
  log.push(await outcome(afterResolve));
  return log.join(", ");
}

export async function rejects(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);
  const p = nextLevel(pulses);

  pulses.fail("sensor lost");
  pulses.emit(1);
  log.push(await outcome(p));
  return log.join(", ");
}

export async function aborts(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);

  const done = new AbortController();
  done.abort();
  log.push(await outcome(nextLevel(pulses, done.signal)));

  const later = new AbortController();
  const stale = nextLevel(pulses, later.signal);
  const listeners = pulses.snapshot();
  setTimeoutLike(later);
  log.push(await outcome(stale));
  pulses.emit(2, listeners);

  const settled = new AbortController();
  const first = nextLevel(pulses, settled.signal);
  pulses.emit(5);
  settled.abort(new Error("too late"));
  log.push(await outcome(first));

  const during = new AbortController();
  const aborted = fromCallback<number>(() => {
    during.abort(new Error("during registration"));
    log.push("registered");
    return () => log.push("cleanup after registration");
  }, during.signal);
  log.push(await outcome(aborted));

  return log.join(", ");
}

/** Aborts `c` from a later turn. */
async function setTimeoutLike(c: AbortController): Promise<void> {
  await delay(1);
  c.abort();
}

export async function waitsForJavaScript(signal: AbortSignal): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);

  log.push(await outcome(nextLevel(pulses, signal)));
  return log.join(", ");
}

export async function voidResults(): Promise<string> {
  const log: string[] = [];
  await fromCallback<void>((resolve) => {
    log.push("registered");
    resolve();
  });

  log.push("resolved");
  return log.join(", ");
}

export async function cleanupOrder(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);
  const awaiting = (async () => {
    log.push(`awaited ${await nextLevel(pulses)}`);
  })();

  // The cleanup runs inside the call that settles; continuations after.
  pulses.emit(8);
  log.push("after emit");
  await awaiting;
  return log.join(", ");
}

export async function subscriptions(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);
  const levels: number[] = [];

  const watching = subscribe<number>(
    (next, end, fail) => {
      next(0);
      const id = pulses.listen(next, fail);
      return () => {
        pulses.remove(id);
        end();
      };
    },
    (level) => {
      levels.push(level);
      if (level > 2) throw new RangeError(`level ${level}`);
    },
  );

  const stale = pulses.snapshot();
  pulses.emit(1);
  pulses.emit(2);
  await delay(1);
  pulses.emit(3);
  pulses.emit(4, stale);
  log.push(await ending(watching));
  log.push(levels.join(" "));
  return log.join(", ");
}

export async function subscriptionEnds(): Promise<string> {
  const log: string[] = [];
  const pulses = new Pulses(log);
  let finish = () => {};

  const ended = subscribe<number>(
    (next, end) => {
      finish = end;
      const id = pulses.listen(next, () => {});
      return () => pulses.remove(id);
    },
    (level) => log.push(`level ${level}`),
  );

  pulses.emit(1);
  finish();
  pulses.emit(2);
  log.push(await ending(ended));

  const failed = subscribe<number>(
    (_next, _end, fail) => {
      const id = pulses.listen(() => {}, fail);
      return () => pulses.remove(id);
    },
    () => {},
  );
  pulses.fail("broken");
  log.push(await ending(failed));

  const c = new AbortController();
  const cancelled = subscribe<number>(
    (next) => {
      const id = pulses.listen(next, () => {});
      return () => pulses.remove(id);
    },
    (level) => {
      log.push(`seen ${level}`);
      if (level === 7) c.abort();
    },
    c.signal,
  );
  pulses.emit(7);
  pulses.emit(8);
  log.push(await ending(cancelled));

  return log.join(", ");
}
