/**
 * lucent:ui — the helpers a component's setup uses.
 *
 * Experimental and internal: this module resolves only when the
 * LUCENT_VIEWS environment variable is `fabric`, and changes without notice
 * until Lucent's views are public.
 *
 * A component's setup runs once per mount, on the main thread: it makes
 * the native objects the component shows and owns directly
 * (`const label = new UILabel()`), and the mount releases them when it
 * ends. Its props are read where they are used (`props.value`): inside
 * `effect`, a read tracks the prop, and the effect runs again when a
 * commit changes it.
 *
 * @experimental
 */

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

/** A length in points, or a percent of the parent's (`"50%"`). */
export type LayoutLength = number | `${number}%`;

/** A length, or `"auto"`: what the layout gives. */
export type LayoutDimension = LayoutLength | "auto";

type LayoutAlign =
  | "auto"
  | "flex-start"
  | "center"
  | "flex-end"
  | "stretch"
  | "baseline"
  | "space-between"
  | "space-around"
  | "space-evenly";

/**
 * React Native's layout style (its Yoga's): a Flex's `style`, and the
 * `layout` of a Flex's child. Numbers are points.
 */
export interface LayoutStyle {
  direction?: "inherit" | "ltr" | "rtl";
  flexDirection?: "column" | "column-reverse" | "row" | "row-reverse";
  justifyContent?:
    | "flex-start"
    | "center"
    | "flex-end"
    | "space-between"
    | "space-around"
    | "space-evenly";
  alignItems?: LayoutAlign;
  alignSelf?: LayoutAlign;
  alignContent?: LayoutAlign;
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  position?: "relative" | "absolute" | "static";
  display?: "flex" | "none" | "contents";
  overflow?: "visible" | "hidden" | "scroll";
  flex?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: LayoutDimension;
  aspectRatio?: number;
  width?: LayoutDimension;
  height?: LayoutDimension;
  minWidth?: LayoutLength;
  maxWidth?: LayoutLength;
  minHeight?: LayoutLength;
  maxHeight?: LayoutLength;
  margin?: LayoutDimension;
  marginHorizontal?: LayoutDimension;
  marginVertical?: LayoutDimension;
  marginTop?: LayoutDimension;
  marginRight?: LayoutDimension;
  marginBottom?: LayoutDimension;
  marginLeft?: LayoutDimension;
  marginStart?: LayoutDimension;
  marginEnd?: LayoutDimension;
  padding?: LayoutLength;
  paddingHorizontal?: LayoutLength;
  paddingVertical?: LayoutLength;
  paddingTop?: LayoutLength;
  paddingRight?: LayoutLength;
  paddingBottom?: LayoutLength;
  paddingLeft?: LayoutLength;
  paddingStart?: LayoutLength;
  paddingEnd?: LayoutLength;
  top?: LayoutDimension;
  right?: LayoutDimension;
  bottom?: LayoutDimension;
  left?: LayoutDimension;
  start?: LayoutDimension;
  end?: LayoutDimension;
  gap?: LayoutLength;
  rowGap?: LayoutLength;
  columnGap?: LayoutLength;
}

/** A child of a Flex: a native view's element, or nothing (`cond && <X />`). */
type FlexChild = object | false | null | undefined;

/**
 * A container of native views laid out by React Native's Yoga (T50): its
 * `style` places its children, and each child's `layout` places it. It
 * writes its children's frames, and nothing else does; a native container
 * among them (a stack view, a LinearLayout) lays out its own. Native view
 * JSX only: `<Flex style={{ flexDirection: "row", gap: 8 }}>…</Flex>`.
 */
export declare class Flex {
  /** Made by its JSX only: nothing can be passed. */
  constructor(none: never);
  "~jsx"?: {
    /** How the Flex places its children: React Native's layout style. */
    style?: LayoutStyle;
    children?: FlexChild | readonly (FlexChild | readonly FlexChild[])[];
  };
}

/** A native view class, as a JSX tag: any class whose instances are `V`. */
export type NativeViewTag<V> = abstract new (...args: never[]) => V;

/**
 * The JSX attributes of a native view class: what each class in its
 * hierarchy gives under its own `~jsx:<module>.<class>` key (derived by
 * rule from its declarations), together. Each key's type takes the class
 * itself (`this`), so a control event's handler gets the tag's class.
 */
export type NativeAttributes<T> = [
  {
    [K in keyof T]-?: K extends `~jsx:${string}` ? (x: NonNullable<T[K]>) => void : never;
  }[keyof T],
] extends [never]
  ? {}
  : {
        [K in keyof T]-?: K extends `~jsx:${string}` ? (x: NonNullable<T[K]>) => void : never;
      }[keyof T] extends (x: infer I) => void
    ? I
    : never;

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
