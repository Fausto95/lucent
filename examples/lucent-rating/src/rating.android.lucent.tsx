import type { View } from "lucent:android/android.view";
import { RatingBar } from "lucent:android/android.widget";
import { effect, expose, signal } from "lucent:ui";
import type { RatingProps } from "./rating.lucent";
import { clamp } from "./stars.lucent";

export function Rating(props: RatingProps): View {
  // The value shown: React's, until a tap or clear() changes it before React does.
  const shown = signal(0);
  effect(() => shown.set(clamp(props.value, props.max ?? 5)));

  const pick = (n: number) => {
    if (n === shown.peek()) return;
    shown.set(n);
    props.onChange?.(n);
  };

  expose({
    clear: () => pick(0),
    value: (): number => shown.peek(),
  });

  // setNumStars, setStepSize and setRating are one-value setters: attributes.
  // setOnRatingBarChangeListener's listener has one method: the onRatingBarChange event.
  return (
    <RatingBar
      numStars={props.max ?? 5}
      stepSize={1}
      rating={shown.get()}
      onRatingBarChange={(_bar, rating, fromUser) => {
        if (fromUser) pick(Math.round(rating));
      }}
    />
  );
}
