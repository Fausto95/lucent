/**
 * A component whose content uses a broader slice of Compose than the
 * toggle's, as JSX: layouts (Column, Row, Box, Spacer), material3's
 * Text and Button, an image, modifiers (padding, size, width, offset, clip, background,
 * clickable, alpha, scale), animations of Dp, Float and Color values, an
 * Animatable driven with spring and tween from a LaunchedEffect, and
 * remember. Its Kotlin compiles against the Compose release Lucent builds
 * with.
 */

export const SLICE = {
  "slice.lucent.ts": `import type { View } from "lucent:android/android.view";

export type Props = { title: string; on: boolean };

export declare function Slice(props: Props): View;
`,
  "slice.android.lucent.tsx": `import {
  Alignment,
  Animatable,
  animateColorAsState,
  animateDpAsState,
  animateFloatAsState,
  Arrangement,
  Box,
  Button,
  Color,
  ColorPainter,
  Column,
  dp,
  Image,
  LaunchedEffect,
  Modifier,
  remember,
  RoundedCornerShape,
  Row,
  Spacer,
  spring,
  Spring,
  Text,
  tween,
} from "lucent:compose";
import { signal } from "lucent:ui";
import type { Props } from "./slice.lucent";

export function Slice(props: Props) {
  const taps = signal(0);
  const tap = () => {
    taps.set(taps.peek() + 1);
  };

  const size = animateDpAsState(props.on ? dp(64) : dp(48), tween({ durationMillis: 300 }));
  const fade = animateFloatAsState(props.on ? 1 : 0.5);
  const tint = animateColorAsState(
    props.on ? Color.Green : Color.Gray,
    spring({ stiffness: Spring.StiffnessLow }),
  );
  const wobble = remember(() => Animatable(0));

  LaunchedEffect(props.on, async () => {
    await wobble.animateTo(8, spring({ dampingRatio: Spring.DampingRatioHighBouncy }));
    await wobble.animateTo(0, tween({ durationMillis: 150 }));
  });

  return (
    <Column modifier={Modifier.padding(dp(16))} verticalArrangement={Arrangement.spacedBy(dp(8))}>
      <Row verticalAlignment={Alignment.CenterVertically}>
        <Image
          painter={ColorPainter(tint.value)}
          contentDescription={null}
          modifier={Modifier.size(size.value).alpha(fade.value)}
        />
        <Spacer modifier={Modifier.width(dp(8))} />
        <Text text={props.title} />
      </Row>
      <Box
        modifier={Modifier.offset({ x: dp(wobble.value) })
          .size(dp(40))
          .clip(RoundedCornerShape(dp(8)))
          .background(tint.value)
          .clickable(() => tap())
          .scale(fade.value)}
        contentAlignment={Alignment.Center}
      >
        <Text text={\`\${taps.get()}\`} />
      </Box>
      <Button onClick={() => tap()}>
        <Text text="Tap" />
      </Button>
    </Column>
  );
}
`,
};
