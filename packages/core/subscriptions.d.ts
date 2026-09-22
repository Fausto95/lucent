/** An owned native subscription with OPEN → CLOSING → CLOSED delivery quiescence. */
export declare class NativeSubscription {
  constructor();
  readonly closed: boolean;
  readonly activeCallbackCount: number;
  /** Debug label set at creation (or overridden); included in LIFETIME_ERROR messages. */
  createdAt: string;
  /** Debug label set on close (or overridden); included in LIFETIME_ERROR messages. */
  closedAt: string;
  /** Start an in-flight delivery; throws `CLOSED` while CLOSING and `LIFETIME_ERROR` after CLOSED. */
  beginDelivery(): void;
  /** End an in-flight delivery; may resume a pending `close()`. */
  endDelivery(): void;
  /** Reject new delivery, wait for in-flight callbacks, run cleanup, reach CLOSED. Idempotent. */
  close(): Promise<void>;
  dispose(): void;
}
/** Run `body` then `await subscription.close()` on every exit path. */
export declare function withSubscription(
  subscription: NativeSubscription,
  body: (subscription: NativeSubscription) => void,
): Promise<void>;
