// The toggle, on Android: its view is Jetpack Compose written here, as
// JSX, and compiled to Kotlin; its logic (flips, the commands, the
// timer) is Lucent code the body calls or reads.
import { TimeAnimator } from "lucent:android/android.animation";
import {
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
  isSystemInDarkTheme,
  LaunchedEffect,
  Modifier,
  remember,
  rememberSaveable,
  RoundedCornerShape,
  spring,
  Spring,
  Text,
} from "lucent:compose";
import { effect, expose, onDispose, signal } from "lucent:ui";
import type { ToggleProps } from "./toggle.lucent";

export function Toggle(props: ToggleProps) {
  const on = signal(false);
  const taps = signal(0);
  const pulses = signal(0);
  // When this mount was set up: it names the mount in the log.
  const mount = Date.now();

  console.log(`LUCENT_TOGGLE ${props.title} setup mount=${mount}`);

  // Each flip is logged with the main thread's time, and sent to JavaScript.
  const flip = (source: string) => {
    const at = Date.now();

    on.set(!on.peek());
    taps.set(taps.peek() + 1);
    console.log(
      `LUCENT_TOGGLE ${props.title} ${source} on=${on.peek()} taps=${taps.peek()} at=${at}`,
    );
    if (source === "timer") console.log(`LUCENT_TICK ${props.title} n=${taps.peek()} at=${at}`);
    props.onChange?.(on.peek(), taps.peek(), at);
  };
  const tap = () => flip("tap");

  // While `auto`, a native animator flips it every 800 ms, on frames of the
  // main thread: Compose animates each flip, whatever JavaScript is doing.
  effect(() => {
    if (props.auto !== true) return;

    const animator = new TimeAnimator();
    let last = Date.now();

    animator.setTimeListener((_animation, _total, _delta) => {
      if (Date.now() - last < 800) return;

      last = Date.now();
      flip("timer");
    });
    animator.start();

    onDispose(() => {
      animator.setTimeListener(null);
      animator.cancel();
    });
  });

  onDispose(() => {
    console.log(`LUCENT_TOGGLE ${props.title} disposed mount=${mount}`);
  });

  // The composition's own lifecycle, as the content reports it.
  const entered = () => {
    console.log(`LUCENT_TOGGLE ${props.title} composition entered mount=${mount}`);
  };
  const left = () => {
    console.log(`LUCENT_TOGGLE ${props.title} composition left mount=${mount}`);
  };
  const pulsed = () => {
    console.log(`LUCENT_TOGGLE ${props.title} pulse ${pulses.peek()} done at=${Date.now()}`);
  };
  // The mount, as text: the body keeps the one it first composed for as
  // saveable state, which no other mount restores.
  const named = () => `${mount}`;

  expose({
    toggle: () => flip("command"),
    pulse: () => {
      pulses.set(pulses.peek() + 1);
      console.log(`LUCENT_TOGGLE ${props.title} pulse at=${Date.now()}`);
    },
    state: (): string => `${on.peek() ? "on" : "off"} taps=${taps.peek()} pulses=${pulses.peek()}`,
  });

  // What composes: lifted into the content, where it runs as the content composes.
  const knob = animateDpAsState(
    on.get() ? dp(28) : dp(0),
    spring({ dampingRatio: Spring.DampingRatioMediumBouncy, stiffness: Spring.StiffnessLow }),
  );
  const track = animateColorAsState(on.get() ? Color(0xff4caf50) : Color(0xff9e9e9e));
  const scale = remember(() => Animatable(1));
  const born = rememberSaveable(() => named());

  DisposableEffect(true, () => {
    entered();
    return () => left();
  });

  // pulse(): a coroutine of the composition scales the toggle up and back.
  LaunchedEffect(pulses.get(), async () => {
    if (pulses.get() === 0) return;

    await scale.animateTo(1.4, spring({ stiffness: Spring.StiffnessVeryLow }));
    await scale.animateTo(1, spring({ dampingRatio: Spring.DampingRatioMediumBouncy }));
    pulsed();
  });

  return (
    <Column horizontalAlignment={Alignment.CenterHorizontally}>
      <Box
        modifier={Modifier.scale(scale.value)
          .size(dp(64), dp(36))
          .clip(RoundedCornerShape(dp(18)))
          .background(track.value)
          .clickable(() => tap())}
      >
        <Box
          modifier={Modifier.offset({ x: knob.value })
            .padding(dp(3))
            .size(dp(30))
            .clip(CircleShape)
            .background(Color.White)}
        />
      </Box>
      {on.get() && <Text text="on" />}
      <Text text={`${props.title}: ${taps.get()} flips`} />
      {/* The configuration the composition has (a change recomposes it), and its mount. */}
      <Text text={isSystemInDarkTheme() ? "dark" : "light"} />
      <Text text={`mount ${born}`} />
    </Column>
  );
}
