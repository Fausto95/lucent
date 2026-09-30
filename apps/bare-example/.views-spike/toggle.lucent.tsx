// The toggle spike's component, in one file for both platforms: a toggle
// whose view is written in Lucent with each platform's declarative UI
// (SwiftUI on iOS, Jetpack Compose on Android), with a counter of its
// flips. Its logic (flips, the commands, the timer) is written once; each
// platform's body, and what only one platform has (a native timer's API,
// the composition's lifecycle), in its PLATFORM branch. A tap, its
// `toggle` command or, while `auto`, a native timer flips it; `pulse`
// scales it. Internal, like the views spike (scripts/views-spike.ts
// --entry toggle.js).
import { TimeAnimator } from "lucent:android/android.animation";
import {
  Alignment as CAlignment,
  Animatable,
  animateColorAsState,
  animateDpAsState,
  Box,
  CircleShape,
  Color as CColor,
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
  Text as CText,
} from "lucent:compose";
import { Timer } from "lucent:ios/Foundation";
import { PLATFORM } from "lucent:platform";
import {
  Alignment,
  Animation,
  Capsule,
  Circle,
  Color,
  Font,
  Text,
  VStack,
  withAnimation,
  ZStack,
} from "lucent:swiftui";
import { effect, expose, onDispose, signal } from "lucent:ui";

export type ToggleProps = {
  title: string;
  /** Flipped by a native timer every 800 ms. */
  auto?: boolean;
  /** Each flip: the new state, the flips so far, and when (the main thread's time). */
  onChange?: (on: boolean, taps: number, at: number) => void;
};

export function Toggle(props: ToggleProps) {
  const on = signal(false);
  const taps = signal(0);
  // iOS scales it with withAnimation; Android counts pulses, which its composition runs.
  const scale = signal(1);
  const pulses = signal(0);
  // When this mount was set up: it names the mount in Android's log.
  const mount = Date.now();

  if (PLATFORM === "android") console.log(`LUCENT_TOGGLE ${props.title} setup mount=${mount}`);

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

  // While `auto`, a native timer flips it (iOS: a Foundation timer; Android:
  // an animator, on frames of the main thread): the toolkit animates each
  // flip, whatever JavaScript is doing.
  effect(() => {
    if (props.auto !== true) return;

    if (PLATFORM === "ios") {
      const timer = Timer.scheduledTimer(0.8, true, () => flip("timer"));

      onDispose(() => timer.invalidate());
    } else {
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
    }
  });

  onDispose(() => {
    if (PLATFORM === "android") console.log(`LUCENT_TOGGLE ${props.title} disposed mount=${mount}`);
  });

  expose({
    toggle: () => flip("command"),
    pulse: () => {
      console.log(`LUCENT_TOGGLE ${props.title} pulse at=${Date.now()}`);

      if (PLATFORM === "ios") {
        withAnimation(Animation.spring({ response: 0.3, dampingFraction: 0.35 }), () =>
          scale.set(1.4),
        );
        Timer.scheduledTimer(0.6, false, () => {
          withAnimation(Animation.easeInOut({ duration: 0.8 }), () => scale.set(1));
        });
      } else pulses.set(pulses.peek() + 1);
    },
    state: (): string =>
      PLATFORM === "ios"
        ? `${on.peek() ? "on" : "off"} taps=${taps.peek()} scale=${scale.peek()}`
        : `${on.peek() ? "on" : "off"} taps=${taps.peek()} pulses=${pulses.peek()}`,
  });

  if (PLATFORM === "ios") {
    // SwiftUI's own lifecycle of the body: shown in a window, or no longer.
    const appeared = () => console.log(`LUCENT_TOGGLE ${props.title} appear at=${Date.now()}`);
    const disappeared = () =>
      console.log(`LUCENT_TOGGLE ${props.title} disappear at=${Date.now()}`);

    return (
      <VStack spacing={6}>
        <ZStack
          alignment={on.get() ? Alignment.trailing : Alignment.leading}
          frame={{ width: 64, height: 36 }}
          scaleEffect={scale.get()}
          animation={[
            Animation.spring({ response: 0.6, dampingFraction: 0.55 }),
            { value: on.get() },
          ]}
          onTapGesture={tap}
          onAppear={appeared}
          onDisappear={disappeared}
        >
          <Capsule fill={on.get() ? Color.green : Color.gray} />
          <Circle fill={Color.white} padding={3} />
        </ZStack>
        <Text font={Font.caption}>{`${props.title}: ${taps.get()} flips`}</Text>
      </VStack>
    );
  }

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

  // What composes: lifted into the content, where it runs as the content composes.
  const knob = animateDpAsState(
    on.get() ? dp(28) : dp(0),
    spring({ dampingRatio: Spring.DampingRatioMediumBouncy, stiffness: Spring.StiffnessLow }),
  );
  const track = animateColorAsState(on.get() ? CColor(0xff4caf50) : CColor(0xff9e9e9e));
  const pop = remember(() => Animatable(1));
  const born = rememberSaveable(() => named());

  DisposableEffect(true, () => {
    entered();
    return () => left();
  });

  // pulse(): a coroutine of the composition scales the toggle up and back.
  LaunchedEffect(pulses.get(), async () => {
    if (pulses.get() === 0) return;

    await pop.animateTo(1.4, spring({ stiffness: Spring.StiffnessVeryLow }));
    await pop.animateTo(1, spring({ dampingRatio: Spring.DampingRatioMediumBouncy }));
    pulsed();
  });

  return (
    <Column horizontalAlignment={CAlignment.CenterHorizontally}>
      <Box
        modifier={Modifier.scale(pop.value)
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
            .background(CColor.White)}
        />
      </Box>
      {on.get() && <CText text="on" />}
      <CText text={`${props.title}: ${taps.get()} flips`} />
      {/* The configuration the composition has (a change recomposes it), and its mount. */}
      <CText text={isSystemInDarkTheme() ? "dark" : "light"} />
      <CText text={`mount ${born}`} />
    </Column>
  );
}
