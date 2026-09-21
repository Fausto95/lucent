/** Native reference object. Extend only inside .lucent.ts source. */
export declare abstract class SharedObject {
  /** Releases the application's native handle. Every alias becomes unusable. */
  dispose(): void;
}
