import { UIColor, UIFont, UILabel, UISlider, type UIView } from "lucent:ios/UIKit";
import { Flex, effect, expose, signal } from "lucent:ui";
import type { RatingProps } from "./rating.lucent";
import { clamp, stars } from "./stars.lucent";

export function Rating(props: RatingProps): UIView {
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

  return (
    <Flex style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <UILabel
        text={stars(shown.get(), props.max ?? 5)}
        textColor={UIColor.systemYellow}
        font={UIFont.systemFont(28)}
      />
      <UISlider
        minimumValue={0}
        maximumValue={props.max ?? 5}
        value={shown.get()}
        onValueChanged={(slider) => pick(Math.round(slider.value))}
      />
    </Flex>
  );
}
