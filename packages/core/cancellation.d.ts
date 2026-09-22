/** Native cooperative cancellation. Instantiate inside .lucent.ts source. */
export declare class CancellationSource {
  constructor();
  readonly cancelled: boolean;
  /** Idempotently request cancellation. Running work stops only at a checkpoint. */
  cancel(): void;
  /** Throw a native LucentError with code CANCELLED when cancellation was requested. */
  throwIfCancelled(): void;
  /** Invalidate the JS handle; this does not request cancellation. */
  dispose(): void;
}
