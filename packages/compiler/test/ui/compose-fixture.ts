/**
 * A component whose content is Jetpack Compose written in Lucent, as JSX:
 * a switch (a track whose knob moves with a spring, and whose color
 * animates) above a line counting its taps. A click calls the setup's
 * `flip`, which flips a signal and sends `onChange`; `pulse()` scales the
 * switch from a coroutine of the composition; the text is computed by the
 * setup from a prop and a signal; a composition effect reports entering
 * and leaving the composition to setup functions. The animations, the
 * remembered Animatable and the effects are composition statements of
 * the component's own code, which compose in its content.
 */

export const TOGGLE = {
  "toggle.lucent.ts": `import type { View } from "lucent:android/android.view";

export type Props = {
  title: string;
  onChange?: (on: boolean, taps: number) => void;
};

export declare function Toggle(props: Props): View;
`,
  "toggle.android.lucent.tsx": `import {
  Alignment,
  Animatable,
  animateColorAsState,
  animateDpAsState,
  Box,
  CircleShape,
  Color,
  Column,
  DisposableEffect,
  dp,
  LaunchedEffect,
  Modifier,
  remember,
  RoundedCornerShape,
  spring,
  Spring,
  Text,
} from "lucent:compose";
import { expose, signal } from "lucent:ui";
import type { Props } from "./toggle.lucent";

export function Toggle(props: Props) {
  const on = signal(false);
  const taps = signal(0);
  const pulses = signal(0);

  const flip = () => {
    on.set(!on.peek());
    taps.set(taps.peek() + 1);
    props.onChange?.(on.peek(), taps.peek());
  };
  const entered = () => {
    console.log("entered");
  };
  const left = () => {
    console.log("left");
  };

  expose({
    toggle: () => flip(),
    pulse: () => {
      pulses.set(pulses.peek() + 1);
    },
    state: (): string => \`\${on.peek() ? "on" : "off"} \${taps.peek()}\`,
  });

  const knob = animateDpAsState(
    on.get() ? dp(24) : dp(0),
    spring({ dampingRatio: Spring.DampingRatioMediumBouncy }),
  );
  const track = animateColorAsState(on.get() ? Color(0xff4caf50) : Color(0xff9e9e9e));
  const scale = remember(() => Animatable(1));

  DisposableEffect(true, () => {
    entered();
    return () => left();
  });

  LaunchedEffect(pulses.get(), async () => {
    if (pulses.get() === 0) return;

    await scale.animateTo(1.5, spring({ stiffness: Spring.StiffnessLow }));
    await scale.animateTo(1, spring());
  });

  return (
    <Column horizontalAlignment={Alignment.CenterHorizontally}>
      <Box
        modifier={Modifier.scale(scale.value)
          .size(dp(56), dp(32))
          .clip(RoundedCornerShape(dp(16)))
          .background(track.value)
          .clickable(() => flip())}
      >
        <Box
          modifier={Modifier.offset({ x: knob.value })
            .padding(dp(3))
            .size(dp(26))
            .clip(CircleShape)
            .background(Color.White)}
        />
      </Box>
      {on.get() && <Text text="on" />}
      <Text text={\`\${props.title}: \${taps.get()} taps\`} />
    </Column>
  );
}
`,
};

/**
 * TOGGLE whose composition statements and returned JSX are `code` (in
 * place of its own, after its setup), importing `compose` more names from
 * lucent:compose and `ui` from lucent:ui, for diagnostics.
 */
export function withContent(
  code: string,
  imports: { compose?: string[]; ui?: string[] } = {},
): Record<string, string> {
  const file = TOGGLE["toggle.android.lucent.tsx"]
    .replace(
      '} from "lucent:compose";',
      `${(imports.compose ?? []).map((n) => `  ${n},\n`).join("")}} from "lucent:compose";`,
    )
    .replace(
      "import { expose, signal }",
      `import { ${["expose", "signal", ...(imports.ui ?? [])].join(", ")} }`,
    );
  const start = file.indexOf("  const knob = ");

  return { ...TOGGLE, "toggle.android.lucent.tsx": `${file.slice(0, start)}${code}\n}\n` };
}
