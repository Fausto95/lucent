// The lifecycle spike's screen: the Toggle (a component whose view is
// written in Lucent with the platform's declarative UI) as navigation
// mounts and unmounts it, in a React Native Modal (another window), and
// across configuration changes the runner makes (scripts/views-spike.ts
// --android-changes): the dark theme, which the app handles, keeps each
// mount, and a font scale, which it doesn't, recreates the Activity, and
// React Native starts its surface again. Each step logs a LUCENT_VIEWS
// line (JavaScript's time in `at=`); each mount's setup, composition and
// disposal a LUCENT_TOGGLE line.
import { useEffect, useRef, useState } from "react";
import { Modal, SafeAreaView, Text, View } from "react-native";
// A relative import is typed as the Lucent component: its React export, as lucent:views/<module> types it.
import * as toggle from "./toggle.lucent";

type ToggleRef = { toggle(): void; pulse(): void; state(): Promise<string> };

const { Toggle } = toggle as unknown as {
  Toggle: (props: { title: string; ref?: React.Ref<ToggleRef> }) => React.ReactNode;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

/** How many times the screen has started in this JavaScript runtime: 2 after a recreation. */
let runs = 0;

/** The toggles a "screen" of the navigation shows. */
const SCREEN = ["T1", "T2", "T3", "T4"];

/** How many times navigation shows that screen, and leaves it. */
const VISITS = 6;

export function LifecycleSpike() {
  const a = useRef<ToggleRef>(null);
  const m = useRef<ToggleRef>(null);
  const [screen, setScreen] = useState(false);
  const [modal, setModal] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const run = ++runs;
    const note = (line: string) => {
      log(`${line} at=${Date.now()}`);
      setLines((all) => [...all.slice(-8), line]);
    };
    const state = async (name: string, ref: React.RefObject<ToggleRef | null>) =>
      note(`state ${name}: ${(await ref.current?.state()) ?? "no view"}`);

    note(`run ${run}`);

    // A recreated Activity's surface starts again: its mounts are new.
    const steps: [number, () => void][] =
      run > 1
        ? [[1000, () => void state("A", a)]]
        : [
            [1000, () => (note("command toggle A"), a.current?.toggle())],
            ...Array.from({ length: VISITS * 2 }, (_, i): [number, () => void] => [
              1500 + i * 500,
              () => {
                const shown = i % 2 === 0;

                note(`screen ${shown ? "shown" : "left"} ${Math.floor(i / 2) + 1}`);
                setScreen(shown);
              },
            ]),
            [8000, () => (note("modal shown"), setModal(true))],
            [9000, () => (note("command toggle M"), m.current?.toggle())],
            [9500, () => void state("M", m)],
            [10500, () => (note("modal closed"), setModal(false))],
            [11000, () => void state("A", a)],
            [11500, () => note("waiting for configuration changes")],
            [16000, () => void state("A", a)],
          ];

    const timers = steps.map(([ms, step]) => setTimeout(step, ms));

    return () => {
      timers.forEach(clearTimeout);
      log(`run ${run} unmounted at=${Date.now()}`);
    };
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ fontWeight: "600" }}>Lucent lifecycle spike</Text>
        <View style={{ flexDirection: "row", gap: 24, alignItems: "flex-start" }}>
          <Toggle ref={a} title="A" />
          {screen
            ? SCREEN.map((title) => (
                <View key={title}>
                  <Toggle title={title} />
                </View>
              ))
            : null}
        </View>
        <Modal visible={modal} transparent animationType="none">
          <View style={{ marginTop: 320, alignItems: "center" }}>
            <View style={{ padding: 16, backgroundColor: "#e0e0e0" }}>
              <Toggle ref={m} title="M" />
            </View>
          </View>
        </Modal>
        {lines.map((line, i) => (
          <Text key={i} style={{ fontSize: 12 }}>
            {line}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}
