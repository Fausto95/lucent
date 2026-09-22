/** Native cooperative cancellation. Instantiate inside .lucent.ts source. */
export declare class CancellationSource {
  constructor();
  readonly cancelled: boolean;
  /** Idempotently request cancellation. Running work stops only at a checkpoint. */
  cancel(): void;
  /** Throw a native LucentError with code CANCELLED when cancellation was requested. */
  throwIfCancelled(): void;
  /** A child source. Cancelling this source cancels the child, including when already cancelled. */
  scope(): CancellationSource;
  /**
   * Complete an operation once. Returns false when cancellation already won or completion already happened.
   * Requesting cancellation does not itself complete the operation.
   */
  finish(): boolean;
  /** Invalidate the JS handle; this does not request cancellation. */
  dispose(): void;
}
