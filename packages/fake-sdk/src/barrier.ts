/** Two-phase barrier for deterministic race tests — never sleep. */
export type Barrier = {
  /** Resolves once the peer has arrived (via `wait`). */
  started(): Promise<void>;
  /** Let peers blocked in `wait` proceed. */
  complete(): void;
  /** Alias for `complete`. */
  release(): void;
  /** Peer: signal arrival, then suspend until `complete` / `release`. */
  wait(): Promise<void>;
};

/** Create a barrier: test awaits `started()`, then calls `complete()`; the peer uses `wait()`. */
export function createBarrier(): Barrier {
  let arrived = false;
  let released = false;
  const startedWaiters: Array<() => void> = [];
  const releaseWaiters: Array<() => void> = [];

  const signalStarted = () => {
    if (arrived) return;
    arrived = true;
    for (const resume of startedWaiters.splice(0)) resume();
  };

  const signalRelease = () => {
    if (released) return;
    released = true;
    for (const resume of releaseWaiters.splice(0)) resume();
  };

  return {
    started(): Promise<void> {
      if (arrived) return Promise.resolve();
      return new Promise((resolve) => {
        startedWaiters.push(resolve);
      });
    },
    complete(): void {
      signalRelease();
    },
    release(): void {
      signalRelease();
    },
    wait(): Promise<void> {
      signalStarted();
      if (released) return Promise.resolve();
      return new Promise((resolve) => {
        releaseWaiters.push(resolve);
      });
    },
  };
}
