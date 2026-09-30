// The hosting spike's screen: Toggles (components whose view is written in
// Lucent with the platform's declarative UI) where an app puts them. One
// in the screen (A), one laid out right to left (R), one in a sheet whose
// title grows while it shows (S), one in a full-screen modal opened and
// closed as a pushed screen is (P). Then the app goes to the background
// and comes back, the toggles unmount and mount again, and a development
// build reloads JavaScript with them mounted. Each step logs a
// LUCENT_VIEWS line, each layout a `layout` line; the toggles log their
// flips and SwiftUI's appear and disappear (LUCENT_TOGGLE lines).
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  type LayoutChangeEvent,
  Modal,
  SafeAreaView,
  Text,
  type TurboModule,
  TurboModuleRegistry,
  View,
} from "react-native";
// Components' React exports exist only when views are generated.
import * as toggle from "./toggle.lucent";
import { starts } from "./work.lucent";

type ToggleRef = { toggle(): void; pulse(): void; state(): Promise<string> };
type DevSettingsModule = TurboModule & { reload(): void };

const { Toggle } = toggle as unknown as {
  Toggle: (props: {
    title: string;
    onChange?: (on: boolean, taps: number, at: number) => void;
    ref?: React.Ref<ToggleRef>;
  }) => React.ReactNode;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function HostingSpike() {
  const a = useRef<ToggleRef>(null);
  const r = useRef<ToggleRef>(null);
  const s = useRef<ToggleRef>(null);
  const p = useRef<ToggleRef>(null);
  const [shown, setShown] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("S");
  const [pushed, setPushed] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [run] = useState(() => starts());

  useEffect(() => {
    const note = (line: string) => {
      log(line);
      setLines((all) => [...all.slice(-12), line]);
    };
    const state = async (name: string, ref: React.RefObject<ToggleRef | null>) => {
      try {
        note(`state ${name}: ${(await ref.current?.state()) ?? "no view"}`);
      } catch (e) {
        note(`state ${name} failed: ${String(e)}`);
      }
    };
    const changes = AppState.addEventListener("change", (next) => note(`app ${next}`));

    let cancelled = false;

    const script = async () => {
      note(`run ${run} (JavaScript starts in this process) dev=${__DEV__}`);
      await sleep(1000);
      await state("A", a);
      await state("R", r);

      if (run > 1) {
        note("command toggle A after reload");
        a.current?.toggle();
        await sleep(500);
        await state("A", a);
        note("after reload: done");
        return;
      }

      note("command toggle A, R");
      a.current?.toggle();
      r.current?.toggle();
      await sleep(1000);

      note("open sheet");
      setSheet(true);
      await sleep(1500);
      note("command toggle S, title S -> longer");
      s.current?.toggle();
      setSheetTitle("S, in a sheet, with a longer title");
      await sleep(1000);
      await state("S", s);
      await sleep(500);
      note("close sheet");
      setSheet(false);
      await sleep(1500);

      note("push screen");
      setPushed(true);
      await sleep(1500);
      note("command toggle P");
      p.current?.toggle();
      await sleep(500);
      await state("P", p);
      note("pop screen");
      setPushed(false);
      await sleep(1000);
      await state("A", a);
      note("waiting (background, foreground)");
      await sleep(5000);

      await state("A", a);
      note("command toggle A after foreground");
      a.current?.toggle();
      await sleep(2500);

      note("unmount A, R");
      setShown(false);
      await sleep(1000);
      note("mount A, R again");
      setShown(true);
      await sleep(1000);
      await state("A", a);
      await state("R", r);
      await sleep(1500);

      // A development build starts JavaScript again (a new runtime, the
      // same process) with the toggles mounted; a release build does
      // nothing. Asked of the native module: DevSettings does nothing in a
      // bundle built without __DEV__.
      if (!cancelled) {
        note("reload");
        await sleep(300);
        TurboModuleRegistry.get<DevSettingsModule>("DevSettings")?.reload();
      }
    };

    script().catch((e) => note(`script failed: ${String(e)}`));

    return () => {
      cancelled = true;
      changes.remove();
    };
  }, [run]);

  const heard = (name: string) => (on: boolean, taps: number) =>
    log(`event ${name} on=${on} taps=${taps}`);

  const layout = (name: string) => (e: LayoutChangeEvent) => {
    const { x, y, width: w, height: h } = e.nativeEvent.layout;
    const round = (v: number) => Math.round(v * 10) / 10;

    log(`layout ${name} ${round(w)}x${round(h)} at ${round(x)},${round(y)}`);
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ fontWeight: "600" }}>Lucent hosting spike (run {run})</Text>
        {shown ? (
          <View style={{ flexDirection: "row", gap: 24, alignItems: "flex-start" }}>
            <View onLayout={layout("A")}>
              <Toggle ref={a} title="A" onChange={heard("A")} />
            </View>
            <View style={{ direction: "rtl", width: 140 }} onLayout={layout("R")}>
              <Toggle ref={r} title="R" onChange={heard("R")} />
            </View>
          </View>
        ) : null}
        {lines.map((line, i) => (
          <Text key={i} style={{ fontSize: 12 }}>
            {line}
          </Text>
        ))}
      </View>
      <Modal
        visible={sheet}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setSheet(false)}
      >
        <View style={{ flex: 1, padding: 24, gap: 12 }} onLayout={layout("sheet")}>
          <Text style={{ fontWeight: "600" }}>A sheet</Text>
          <View style={{ alignItems: "flex-start" }} onLayout={layout("S")}>
            <Toggle ref={s} title={sheetTitle} onChange={heard("S")} />
          </View>
        </View>
      </Modal>
      <Modal visible={pushed} presentationStyle="fullScreen" animationType="slide">
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 24, gap: 12 }} onLayout={layout("screen")}>
            <Text style={{ fontWeight: "600" }}>A pushed screen</Text>
            <View style={{ alignItems: "flex-start" }} onLayout={layout("P")}>
              <Toggle ref={p} title="P" onChange={heard("P")} />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
