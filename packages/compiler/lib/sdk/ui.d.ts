/**
 * lucent:ui — the helpers a component's setup uses.
 *
 * Experimental and internal: this module resolves only when the
 * LUCENT_VIEWS environment variable is `fabric`, and changes without notice
 * until Lucent's views are public.
 *
 * A component's setup runs once per mount, on the main thread. Its props
 * are read where they are used (`props.value`): inside `effect`, a read
 * tracks the prop, and the effect runs again when a commit changes it.
 *
 * @experimental
 */

/**
 * Makes the native object the component shows, or another it owns, once,
 * now: `create()`'s result.
 */
export declare function native<T extends object>(create: () => T): T;

/**
 * Runs `run` now, and again after a prop or signal it read changes. Before
 * it runs again, and when the view goes, what it registered with
 * `onDispose` runs.
 */
export declare function effect(run: () => void): void;

/** A value of the view's own, which effects track like props. */
export interface Signal<T> {
  /** The value; inside an effect, the effect runs again when it changes. */
  get(): T;
  /** The value, without tracking it. */
  peek(): T;
  /** Changes it, unless `value` is the same (Object.is), running what read it. */
  set(value: T): void;
}

export declare function signal<T>(initial: T): Signal<T>;

/**
 * A signal given to a view of a toolkit body that changes it: SwiftUI's
 * Binding, or Compose's value and its change callback. The view shows the
 * signal's value, and a change the user makes sets the signal (which may
 * keep another value: the view shows what it keeps).
 */
export interface Bound<T> {
  readonly __lucentBound: T;
}

/** `signal`, bound to the view of a body it is given to: only there. */
export declare function bind<T>(signal: Signal<T>): Bound<T>;

/**
 * The numbers from `from` to `to`, both included, given to a view of a
 * toolkit body that takes a range (a slider's, a stepper's bounds):
 * SwiftUI's `from ... to`. Written where the view takes it, as
 * bind(signal) is.
 */
export interface ClosedRange<T> {
  readonly __lucentRange: T;
}

/** The closed range from `from` to `to`, for the view of a body it is given to: only there. */
export declare function range(from: number, to: number): ClosedRange<number>;

/**
 * Gives the component's React ref `commands`: called once, at the top of
 * setup, with an object literal of functions. A command returning nothing
 * runs on the main thread; one returning a value (or a promise) answers
 * JavaScript's promise.
 */
export declare function expose<T extends object>(commands: T): void;

/**
 * Runs `cleanup` when the view goes; inside an effect, before the effect
 * runs again.
 */
export declare function onDispose(cleanup: () => void): void;

/**
 * The type of a component's `children` prop: the React elements
 * JavaScript nests in it, which React Native mounts in the view `slot`
 * gives setup. Setup never reads them.
 */
export interface Children {
  readonly __lucentChildren: never;
}

/**
 * The view a component's React children are mounted in, for a component
 * whose props declare `children: Children`: called once, in a `const` at
 * the top of setup, with the platform's container class
 * (`slot<UIView>()` on iOS, `slot<ViewGroup>()` on Android).
 *
 * Put it in the view setup returns, where the children belong: it fills
 * the view it is added to unless setup sizes it. React lays the children
 * out in the component's own coordinates, wherever the slot is, and they
 * show within the slot's bounds. React Native adds, moves and removes
 * them: setup never changes the slot's subviews.
 */
export declare function slot<T extends object>(): T;

/**
 * Has the view measured again, once the main thread's current work ends:
 * for a change to its native content its host would not hear of. The host
 * hears of every function setup makes running (an effect, a native
 * callback, a command), since their code may change the view; code after
 * an `await` runs in none of them.
 */
export declare function invalidateSize(): void;

declare const delivery: unique symbol;

/**
 * Marks an event prop's callback type: JavaScript hears each of its
 * events at a lower priority than a discrete one (a tap), so React may
 * batch what they update. For events that come often: a drag, a timer.
 * An unmarked event is discrete.
 */
export type Continuous<F extends (...args: never[]) => void> = F & {
  readonly [delivery]?: "continuous";
};

/**
 * Marks an event prop's callback type: continuous, and while the view's
 * latest event waiting for JavaScript is one of this type, a new one
 * replaces it, so JavaScript hears the latest value. For events whose
 * latest value is all that counts: a scroll position, a level.
 */
export type Coalesced<F extends (...args: never[]) => void> = F & {
  readonly [delivery]?: "coalesced";
};
