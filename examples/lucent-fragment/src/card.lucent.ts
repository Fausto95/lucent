// A card whose Android root is a Fragment (card.android.lucent.tsx): the
// host commits it to the Activity's FragmentManager over a container in
// the component's view. iOS shows a label (card.ios.lucent.tsx).
import type { View } from "lucent:android/android.view";
import type { UIView } from "lucent:ios/UIKit";

export type CardProps = {
  /** What the card says. */
  text: string;
};

export declare function Card(props: CardProps): UIView | View;

/**
 * Whether a card's fragment shows its view in the component, laid out:
 * "shown" once one does, what it got to before, and "none" on iOS.
 */
export declare function cardShown(): Promise<string>;
