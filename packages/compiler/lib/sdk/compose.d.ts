/**
 * lucent:compose — Jetpack Compose, for a component's content on Android.
 *
 * Experimental and internal: this module resolves only when the
 * LUCENT_VIEWS environment variable is `fabric`, and changes without notice
 * until Lucent's views are public.
 *
 * A component's setup returns `compose(() => …)`: the function is the
 * content's composable body, compiled to Kotlin. It reads the setup's
 * props, signals and functions: a number, boolean or string the setup
 * computes is Compose state, and a setup function the body calls from a
 * callback runs as Lucent code. Everything else in the body is Compose
 * itself, in call form: a composable showing UI takes Kotlin's named
 * arguments as one object (`Box({ modifier })`), and its trailing content
 * lambda is a function returning an array of what it shows (`Column({},
 * () => [A(), B()])`); other functions take Kotlin's parameters in order,
 * an options object holding the defaulted ones where Kotlin's order cannot
 * (`spring({ stiffness })`); its modifiers, animations and effects are
 * Compose's.
 *
 * A value Compose pairs with the callback of its changes (`value` and
 * `onValueChange`) takes a setup signal bound to both instead,
 * `bind(signal)` from lucent:ui.
 *
 * Below lucent:compose's own declarations come Compose's, under their own
 * names, made from the bindings of the Compose release Lucent builds with.
 * Float, Int, Long, Short and Byte are Kotlin's number types: a number the
 * body passes to one is converted.
 *
 * @experimental
 */
import type { ViewGroup } from "lucent:android/android.view";
import type { Bound } from "lucent:ui";

/** Kotlin's Float: a number, converted where the body passes it. */
export type Float = number & { readonly "lucent:compose.Float"?: never };
/** Kotlin's Int. */
export type Int = number & { readonly "lucent:compose.Int"?: never };
/** Kotlin's Long. */
export type Long = number & { readonly "lucent:compose.Long"?: never };
/** Kotlin's Short. */
export type Short = number & { readonly "lucent:compose.Short"?: never };
/** Kotlin's Byte. */
export type Byte = number & { readonly "lucent:compose.Byte"?: never };

/**
 * What a composable call shows: an item of the content a body or a content
 * lambda returns, never a value setup holds.
 */
export interface Composed {
  readonly "lucent:compose.Composed": true;
}

/** Content: what a composable shows, in order, or nothing where a condition is false. */
export type Shown = Composed | false | null | undefined | readonly Shown[];

/** A @Composable content lambda: its statements compose, and it returns what it shows. */
export type Content = () => readonly Shown[];

/**
 * Content composed in a receiver scope (a Row's RowScope): the lambda's
 * first parameter is the scope, whose methods and Modifier run in it.
 */
export type ScopedContent<S> = (scope: S) => readonly Shown[];

/**
 * The view showing `body`'s composition: what a component's setup returns.
 * Setup calls it once, in its own code.
 */
export declare function compose(body: () => Shown): ComposeView;

/** The Android view hosting a composition. */
export declare class ComposeView extends ViewGroup {
  private constructor();
}
