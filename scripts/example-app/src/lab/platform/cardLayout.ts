// The layout React Native reported for the Platform screen's card, through
// the component's onLayout: a case checks it came.
import type { LayoutChangeEvent } from "react-native";

let reported = "";

/** The card's onLayout. */
export function cardLaidOut(e: LayoutChangeEvent): void {
  const { width, height } = e.nativeEvent.layout;
  reported = width > 0 && height > 0 ? "laid out" : `laid out at ${width}×${height}`;
}

/** What the card's onLayout reported, or "" before it fired. */
export function cardLayout(): string {
  return reported;
}
