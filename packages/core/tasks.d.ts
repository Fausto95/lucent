/** A native operation scope. Instantiate in .lucent.ts; dispose is not close. */
export declare class TaskScope {
  constructor();
  readonly closing: boolean;
  readonly activeCount: number;
  begin(): NativeTask;
  /** Reject new work, request cancellation, and await real completion of every task. */
  close(): Promise<void>;
  dispose(): void;
}
/**
 * Structured task group: child failure cancels siblings; `close` awaits
 * quiescence and rethrows the primary child error.
 */
export declare class TaskGroup {
  constructor();
  readonly closing: boolean;
  readonly activeCount: number;
  begin(): NativeTask;
  /** Reject new work, cancel active children, await completion, rethrow primary error. */
  close(): Promise<void>;
  dispose(): void;
}
/** The SDK adapter must retain this task and finish it on every actual completion path. */
export declare class NativeTask {
  constructor(scope: TaskScope);
  readonly cancelled: boolean;
  readonly finished: boolean;
  cancel(): void;
  throwIfCancelled(): void;
  /** Complete once; true only for the first completion if cancellation did not win. */
  finish(): boolean;
  dispose(): void;
}
