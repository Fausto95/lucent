import { Timer } from "lucent:ios/Foundation";
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
import type { ToggleProps } from "./toggle.lucent";

export function Toggle(props: ToggleProps) {
  const on = signal(false);
  const taps = signal(0);
  const scale = signal(1);

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

  // SwiftUI's own lifecycle of the body: shown in a window, or no longer.
  const appeared = () => console.log(`LUCENT_TOGGLE ${props.title} appear at=${Date.now()}`);
  const disappeared = () => console.log(`LUCENT_TOGGLE ${props.title} disappear at=${Date.now()}`);

  // While `auto`, a native timer flips it: SwiftUI animates each flip,
  // whatever JavaScript is doing.
  effect(() => {
    if (!props.auto) return;

    const timer = Timer.scheduledTimer(0.8, true, () => flip("timer"));

    onDispose(() => timer.invalidate());
  });

  expose({
    toggle: () => flip("command"),
    pulse: () => {
      console.log(`LUCENT_TOGGLE ${props.title} pulse at=${Date.now()}`);
      withAnimation(Animation.spring({ response: 0.3, dampingFraction: 0.35 }), () =>
        scale.set(1.4),
      );
      Timer.scheduledTimer(0.6, false, () => {
        withAnimation(Animation.easeInOut({ duration: 0.8 }), () => scale.set(1));
      });
    },
    state: (): string => `${on.peek() ? "on" : "off"} taps=${taps.peek()} scale=${scale.peek()}`,
  });

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
