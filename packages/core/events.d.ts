/** An app callback carried by a native view prop. */
export type Event<T> = (...args: T extends void ? [] : [payload: T]) => void;
export interface Subscription {
  remove(): void;
}
export interface NativeEvent<T> {
  /** Available inside Lucent source only. */
  emit(...args: T extends void ? [] : [payload: T]): void;
  /** Available from the generated application proxy. */
  subscribe(listener: Event<T>): Subscription;
}
/** Declare at module scope in a .lucent.ts file. No JS implementation is executed. */
export declare function event<T>(): NativeEvent<T>;
