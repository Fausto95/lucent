/**
 * lucent:compose — Jetpack Compose, for a component's content on Android.
 *
 * Experimental and internal: this module resolves only when the
 * LUCENT_VIEWS environment variable is `fabric`, and changes without notice
 * until Lucent's views are public.
 *
 * A component returns its content: JSX, compiled to Kotlin. A composable
 * showing UI is an element (`<Box modifier={…}>`), whose props are
 * Kotlin's named arguments and whose children are its trailing content
 * lambda, or a function of the lambda's scope (`{(row) => …}`); a lazy
 * list's items are elements of its scope (`{(list) => <list.items
 * items={…} key={…}>…</list.items>}`). The component's statements that
 * compose (`animateDpAsState(…)`, `remember(…)`, `LaunchedEffect(…)`)
 * run in the content, in order, before what the JSX shows; the rest of
 * its code is its setup, which runs once and reads none of their values.
 * The content reads the setup's props, signals and functions: a number,
 * boolean or string the setup computes is Compose state, and a setup
 * function the content calls from a callback runs as Lucent code. Other
 * functions take Kotlin's parameters in order, an options object holding
 * the defaulted ones where Kotlin's order cannot (`spring({ stiffness })`);
 * modifiers, animations and effects are Compose's.
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
import type { View, ViewGroup } from "lucent:android/android.view";
import type { Bound, NativeViewTag } from "lucent:ui";

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
 * What an element shows (`<Box …/>`): an item of content, the value of
 * JSX, never a value setup holds.
 */
export interface Composed {
  readonly "lucent:compose.Composed": true;
}

/** Content: what composables show, in order, or nothing where a condition is false. */
export type Shown = Composed | false | null | undefined | readonly Shown[];

/** A @Composable content lambda given as a prop: its statements compose, and it returns what it shows. */
export type Content = () => Shown;

/**
 * A content lambda composed in a receiver scope (a Row's RowScope), given
 * as a prop. Its first parameter is the scope, whose methods and Modifier
 * run in it.
 */
export type ScopedContent<S> = (scope: S) => Shown;

/**
 * An element's children composed in a receiver scope: what they show, or a
 * function of the scope showing it. Children that use the scope take the
 * function: `{(row) => <Text modifier={row.Modifier.weight(1)} … />}`.
 */
export type ScopedChildren<S> = Shown | ((scope: S) => Shown);

/**
 * How TypeScript types the JSX of an Android file. An element is a
 * composable: a function of its props, whose children are its `children`
 * prop. It may also be a view class, typed with its declarations' `~jsx`
 * attributes.
 */
export declare namespace JSX {
  type Element = Composed & View;

  type ElementType = ((props: never) => Composed) | NativeViewTag<View>;

  interface ElementChildrenAttribute {
    children: {};
  }

  interface ElementAttributesProperty {
    "~jsx": {};
  }

  interface IntrinsicClassAttributes<T> {
    /** Makes the view, where its class has no frame or Context constructor to make it with. */
    create?: () => T;
  }

  interface IntrinsicElements {}
}

/** The Android view hosting a composition: the view a component returning JSX makes. */
export declare class ComposeView extends ViewGroup {
  private constructor();
}
