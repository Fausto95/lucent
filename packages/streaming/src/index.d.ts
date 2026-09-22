/**
 * Owned file chunk source. Prefetch is bounded by `capacity` (package default 4).
 * Each `readChunk` returns an owned `Uint8Array` buffer. `cancel` aborts the
 * bounded transform queue.
 */
export declare class FileChunkSource {
  constructor(path: string, chunkSize: number, capacity: number);
  readonly closed: boolean;
  readonly capacity: number;
  readChunk(): Promise<Uint8Array>;
  /** CI-only borrowed chunk view; must not escape. */
  borrowChunk(): Promise<Uint8Array>;
  /** Prefetch one transformed chunk into the bounded queue. */
  enqueueTransform(): number;
  cancel(): void;
  close(): Promise<void>;
  dispose(): void;
}

/**
 * Owned write sink. `write` borrows the chunk for the duration of the awaited
 * call; the caller retains ownership afterward unless moved by Lucent policy.
 */
export declare class FileWriteSink {
  constructor(path: string);
  readonly closed: boolean;
  write(chunk: Uint8Array): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  dispose(): void;
}

/** Transform a borrowed chunk into a new owned buffer (CI stub: identity copy). */
export declare function transformChunk(chunk: Uint8Array): Uint8Array;

/** CI helper: live owned buffer count. */
export declare function liveBuffers(): number;
