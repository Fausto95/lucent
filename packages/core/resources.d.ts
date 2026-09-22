/** A native resource with OPEN → CLOSING → CLOSED lease lifecycle. */
export declare class NativeResource {
  constructor();
  readonly closed: boolean;
  readonly leaseCount: number;
  /** Debug label set at creation (or overridden); included in LIFETIME_ERROR messages. */
  createdAt: string;
  /** Debug label set on close (or overridden); included in LIFETIME_ERROR messages. */
  closedAt: string;
  /** Acquire a lease; throws `CLOSED` while CLOSING and `LIFETIME_ERROR` after CLOSED. */
  beginOperation(): void;
  /** Release a lease; may resume a pending `close()`. */
  endOperation(): void;
  /** Reject new work, wait for leases, run cleanup, reach CLOSED. Idempotent. */
  close(): Promise<void>;
  dispose(): void;
}

/**
 * Multi-resource ownership bag. Prefer `resourceScope` so close-all runs on every
 * exit path — Lucent has no `try`/`finally` yet.
 */
export declare class ResourceScope {
  constructor();
  /** Register `resource` for reverse-order close; returns the same handle. */
  own(resource: NativeResource): NativeResource;
  /** Await `close()` for each owned resource, last-owned first. Idempotent. */
  closeAll(): Promise<void>;
  dispose(): void;
}

/** Run `body` then `await resource.close()` on every exit path. */
export declare function withResource(resource: NativeResource, body: (resource: NativeResource) => void): Promise<void>;

/**
 * Run `body` with a fresh `ResourceScope`, then `await scope.closeAll()` on every
 * exit path (normal return and thrown error). Bodies are synchronous
 * `NativeCallback`s; finish async work before returning.
 */
export declare function resourceScope(body: (scope: ResourceScope) => void): Promise<void>;
