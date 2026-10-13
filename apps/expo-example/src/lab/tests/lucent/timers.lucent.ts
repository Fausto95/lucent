// setTimeout, setInterval and queueMicrotask run as JavaScript runs them:
// after the current code and its microtasks, timers by when they fall due,
// and those due together in the order they were started.

/** The order a turn's code, its microtasks and timers of several delays run in. */
export function order(): Promise<string> {
  const log: string[] = [];

  return new Promise((resolve) => {
    setTimeout(() => log.push("t10"), 10);
    setTimeout(() => {
      log.push("t0a");
      queueMicrotask(() => log.push("t0a-micro"));
    }, 0);

    const cleared = setTimeout(() => log.push("never"), 5);

    setTimeout(() => {
      log.push("t0b");
      clearTimeout(cleared);
    }, 0);
    setTimeout(() => log.push("negative"), -5);
    queueMicrotask(() => {
      log.push("micro1");
      queueMicrotask(() => log.push("micro2"));
    });
    log.push("sync");
    setTimeout(() => resolve(log.join(" ")), 30);
  });
}

/** An interval runs until cleared, from its own function. */
export function ticks(): Promise<string> {
  return new Promise((resolve) => {
    let n = 0;
    const id = setInterval(() => {
      n++;
      if (n === 3) {
        clearInterval(id);
        setTimeout(() => resolve(`ticked ${n}`), 25);
      }
    }, 5);
  });
}

/** Clearing a timer that already ran, an undefined id, or one never given, does nothing. */
export function clears(): Promise<string> {
  return new Promise((resolve) => {
    let ran = 0;
    const once = setTimeout(() => {
      ran++;
      clearTimeout(once);
    }, 0);

    clearTimeout(undefined);
    clearInterval(undefined);
    setTimeout(() => {
      clearTimeout(once);
      resolve(`ran ${ran}`);
    }, 10);
  });
}

/** An awaited promise's continuation is a microtask too: after those queued before it. */
export async function awaited(): Promise<string> {
  const log: string[] = [];

  queueMicrotask(() => log.push("queued"));
  log.push("before");
  await Promise.resolve();
  log.push("after");
  setTimeout(() => log.push("late"), 0);
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  return log.join(" ");
}

/** A timeout without a delay runs as one of 0. */
export function noDelay(): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("no delay"));
  });
}
