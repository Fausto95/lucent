/** Live-object counts for asserting cleanup after deterministic native tests. */
export type CounterSnapshot = {
  handles: number;
  resources: number;
  leases: number;
  delegates: number;
  callbacks: number;
  tasks: number;
  buffers: number;
  subscriptions: number;
};

export const emptySnapshot = (): CounterSnapshot => ({
  handles: 0,
  resources: 0,
  leases: 0,
  delegates: 0,
  callbacks: 0,
  tasks: 0,
  buffers: 0,
  subscriptions: 0,
});

/** Mutable JS-side counters mirroring the native FakeCounters registry. */
export class LiveCounters {
  private counts: CounterSnapshot = emptySnapshot();

  adjust(key: keyof CounterSnapshot, delta: number): void {
    this.counts[key] += delta;
  }

  snapshot(): CounterSnapshot {
    return { ...this.counts };
  }

  reset(): void {
    this.counts = emptySnapshot();
  }
}
