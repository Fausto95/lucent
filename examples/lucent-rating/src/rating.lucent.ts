// A star rating made of the platforms' own controls: a UISlider under a
// label of stars on iOS, in a column Lucent's Flex lays out with Yoga, and
// Android's RatingBar.
// JavaScript sets `value` and `max`, hears `onChange` when a star is
// tapped, and calls `clear()` or `value()` through a ref. It is written as
// platform files (rating.ios.lucent.tsx, rating.android.lucent.tsx)
// because its commands use each platform's views: expose() can't stand in
// a PLATFORM branch. This file declares what both implement; stars.lucent.ts
// holds the logic they share.
import type { View } from "lucent:android/android.view";
import type { UIView } from "lucent:ios/UIKit";

export type RatingProps = {
  /** The stars shown filled, from 0 to max. */
  value: number;
  /** How many stars: 5 by default. */
  max?: number;
  /** A star was tapped: the new value. */
  onChange?: (value: number) => void;
};

export declare function Rating(props: RatingProps): UIView | View;
