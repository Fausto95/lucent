/**
 * Owned handle for a scheduled background job.
 *
 * Durable (`durable: true`) jobs are OS-scheduled and must carry a serializable
 * payload with an explicit `payloadVersion`. In-process jobs (`durable: false`)
 * live only while the owning process/scope is alive.
 */
export declare class BackgroundJobHandle {
  constructor(jobId: string, payloadVersion: number, payload: string, durable: boolean);
  readonly closed: boolean;
  readonly jobId: string;
  readonly payloadVersion: number;
  readonly durable: boolean;
  /** CI-only borrowed job id view; must not escape. */
  borrowJobId(): string;
  cancel(): void;
  /** Run once if still scheduled; rejects on version mismatch or cancel. */
  runOnce(): number;
  close(): Promise<void>;
  dispose(): void;
}

/** CI helper: number of jobs recorded by the native stub. */
export declare function scheduledCount(): number;

/** CI helper: successful `runOnce` invocations. */
export declare function runCount(): number;
