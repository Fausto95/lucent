// The toggle spike's screen: two Toggles, components whose view is
// written in Lucent with the platform's declarative UI (SwiftUI on iOS,
// Jetpack Compose on Android). Commands flip the first (the knob springs
// across) and pulse it, requests read its Lucent state, a new title
// reaches the second's text, and the second unmounts and mounts again.
// Then a native timer flips the first while JavaScript blocks and module
// code holds the Lucent lock: the toolkit animates each flip on time, and
// JavaScript hears of them late. Then the screen waits for taps. Each
// step logs a LUCENT_VIEWS line (JavaScript's time in `at=`); each flip a
// LUCENT_TOGGLE line (the main thread's), and a timer's a LUCENT_TICK
// line.
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, SafeAreaView, Text, View } from "react-native";
// A relative import is typed as the Lucent component: its React export, as lucent:views/<module> types it.
import * as toggle from "./toggle.lucent";
import { locked } from "./work.lucent";

type ToggleRef = { toggle(): void; pulse(): void; state(): Promise<string> };

const { Toggle } = toggle as unknown as {
  Toggle: (props: {
    title: string;
    auto?: boolean;
    onChange?: (on: boolean, taps: number, at: number) => void;
    style?: object;
    ref?: React.Ref<ToggleRef>;
  }) => React.ReactNode;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

/** Blocks the JavaScript thread for `ms`. */
function block(ms: number) {
  const end = Date.now() + ms;
  let x = 0;

  while (Date.now() < end) x = (x * 31 + 7) % 1000003;

  return x;
}

export function ToggleSpike() {
  const a = useRef<ToggleRef>(null);
  const b = useRef<ToggleRef>(null);
  const [title, setTitle] = useState("B");
  const [auto, setAuto] = useState(false);
  const [shown, setShown] = useState(true);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    // The effect's own: it runs once.
    const note = (line: string) => {
      log(`${line} at=${Date.now()}`);
      setLines((all) => [...all.slice(-12), line]);
    };
    const state = async (name: string, ref: React.RefObject<ToggleRef | null>) =>
      note(`state ${name}: ${(await ref.current?.state()) ?? "no view"}`);
    const phase = (name: string, work: () => unknown) => {
      log(`phase ${name} start at=${Date.now()}`);
      const out = work();
      log(`phase ${name} end at=${Date.now()} out=${String(out).split(",")[0]}`);
    };

    const steps: [number, () => void][] = [
      [1000, () => void state("A", a)],
      [1500, () => (note("command toggle A"), a.current?.toggle())],
      [2500, () => (note("command pulse A"), a.current?.pulse())],
      [3500, () => void state("A", a)],
      [4000, () => (note("prop title B -> Beta"), setTitle("Beta"))],
      [4500, () => void state("B", b)],
      [5000, () => (note("unmount B"), setShown(false))],
      [6000, () => (note("mount B again"), setShown(true))],
      [6500, () => void state("B", b)],
      [7000, () => (note("auto on: a native timer flips A"), setAuto(true))],
      [8000, () => phase("js-block", () => block(3000))],
      [12000, () => phase("lucent-lock", () => locked(1000))],
      [14000, () => (note("auto off"), setAuto(false))],
      [14500, () => void state("A", a)],
      [15000, () => note("waiting for taps")],
    ];

    const timers = steps.map(([ms, step]) => setTimeout(step, ms));

    return () => timers.forEach(clearTimeout);
  }, []);

  const heard = (name: string) => (on: boolean, taps: number, at: number) => {
    const rx = Date.now();

    log(`tick-rx ${name} mount=1 n=${taps} at=${at} rx=${rx}`);
    log(`event ${name} on=${on} taps=${taps} late=${rx - at} ms`);
  };

  const layout = (name: string) => (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;

    log(`layout ${name} ${Math.round(w * 10) / 10}x${Math.round(h * 10) / 10}`);
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ fontWeight: "600" }}>Lucent toggle spike</Text>
        <View style={{ flexDirection: "row", gap: 24, alignItems: "flex-start" }}>
          <View onLayout={layout("A")}>
            <Toggle ref={a} title="A" auto={auto} onChange={heard("A")} />
          </View>
          {shown ? (
            <View onLayout={layout("B")}>
              <Toggle ref={b} title={title} onChange={heard("B")} />
            </View>
          ) : null}
        </View>
        {lines.map((line, i) => (
          <Text key={i} style={{ fontSize: 12 }}>
            {line}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}
