// The sizing spike's screen: a Blurb with no size of its own in a column
// whose width changes, while its text grows, shrinks and changes natively
// (its `append` command, and a native timer while JavaScript is
// blocked), whose direction turns right to left, and which is unmounted
// while its host's measurement waits for JavaScript, then mounted again;
// a Blurb with an explicit size, padding and border; one in a row, at its
// natural width; and two Pictures whose images arrive after an await, one
// calling invalidateSize(). Each layout its wrapper sees is logged as a
// LUCENT_VIEWS line with the time since the screen loaded, so the log
// shows how many layouts each change takes to settle.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, SafeAreaView, Text, View } from "react-native";
// A relative import is typed as the Lucent component: its React export, as lucent:views/<module> types it.
import * as sizing from "./sizing.lucent";

type BlurbRef = { append(more: string): void; appendLater(more: string): void };
type PictureRef = { load(announce: boolean): void };

const { Blurb, Picture } = sizing as unknown as {
  Blurb: (props: { text: string; style?: object; ref?: React.Ref<BlurbRef> }) => React.ReactNode;
  Picture: (props: { name: string; ref?: React.Ref<PictureRef> }) => React.ReactNode;
};

const SHORT = "Short text";
const OTHER = "Another text, long enough to wrap once more at this width";
const LONG =
  "A much longer text, which wraps onto several lines once its container is narrow enough to need them";

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

// When the screen loaded: log lines give the time since.
const loaded = performance.now();
const at = () => `${Math.round(performance.now() - loaded)} ms`;

/** Keeps the JavaScript thread busy for `ms`. */
const block = (ms: number) => {
  const start = performance.now();

  while (performance.now() - start < ms) {
    // Blocked.
  }
};

const layout = (name: string) => (e: LayoutChangeEvent) => {
  const { width: w, height: h } = e.nativeEvent.layout;

  log(`layout ${name} ${Math.round(w * 10) / 10}x${Math.round(h * 10) / 10} at ${at()}`);
};

export function SizingSpike() {
  const blurb = useRef<BlurbRef>(null);
  const quiet = useRef<PictureRef>(null);
  const announced = useRef<PictureRef>(null);
  const [text, setText] = useState(SHORT);
  const [width, setWidth] = useState(300);
  const [rtl, setRtl] = useState(false);
  const [shown, setShown] = useState(true);
  // Set by the unmount step: its commit blocks JavaScript (after every commit).
  const blockAfterCommit = useRef(false);

  useLayoutEffect(() => {
    if (!blockAfterCommit.current) return;

    blockAfterCommit.current = false;
    block(300);
  });

  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    // The effect's own: it runs once.
    const note = (line: string) => {
      log(`${line} at ${at()}`);
      setLines((all) => [...all, line]);
    };

    const steps: [number, string, () => void][] = [
      [1000, "step long text", () => setText(LONG)],
      [2000, "step narrow 160", () => setWidth(160)],
      [3000, "step short text", () => setText(SHORT)],
      [4000, "step append natively", () => blurb.current?.append(" and a native tail that wraps")],
      // The width commit is queued before the command runs on the main
      // thread: the command's measurement (old width) lands after it.
      [
        5000,
        "step widen 300 then append",
        () => {
          setWidth(300);
          blurb.current?.append(" / more");
        },
      ],
      // A native timer appends while JavaScript is blocked: the renderer
      // applies state updates on the JavaScript thread, so the measured
      // size waits for it. (A command sent from a blocked task would
      // itself wait: commands leave when the task ends.)
      [
        6000,
        "step append natively in 200 ms",
        () =>
          blurb.current?.appendLater(
            ", and a tail a native timer adds, long enough for another line",
          ),
      ],
      [6050, "step block JavaScript 500 ms", () => block(500)],
      // Images arriving after an await: only the second says so.
      [
        7000,
        "step load pictures",
        () => {
          quiet.current?.load(false);
          announced.current?.load(true);
        },
      ],
      [8000, "step right to left", () => setRtl(true)],
      // The host measures the new text while JavaScript is blocked (in the
      // commit's layout effect); the Blurb is unmounted before its result
      // can be applied.
      [
        9000,
        "step other text, block JavaScript 300 ms, unmount",
        () => {
          blockAfterCommit.current = true;
          setText(OTHER);
          // After the blocked commit, before the host's result is applied.
          setTimeout(() => setShown(false), 0);
        },
      ],
      [10000, "step mount again", () => setShown(true)],
      // scripts/views-spike.ts --font-scale changes the text size about now (iOS),
      // 15 s after the launch.
      [11000, "step font scale", () => {}],
    ];

    const timers = steps.map(([ms, line, step]) =>
      setTimeout(() => {
        note(line);
        step();
      }, ms),
    );

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ fontWeight: "600" }}>Lucent sizing spike</Text>
        <View
          style={{ width, backgroundColor: "#eee", direction: rtl ? "rtl" : "ltr" }}
          onLayout={layout("intrinsic")}
        >
          {shown && <Blurb ref={blurb} text={text} />}
        </View>
        <View style={{ alignItems: "flex-start" }} onLayout={layout("fixed")}>
          <Blurb
            text="fixed 120x40, padding 6, border 2"
            style={{
              width: 120,
              height: 40,
              padding: 6,
              borderWidth: 2,
              borderColor: "#00f",
              backgroundColor: "#8cf",
            }}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View onLayout={layout("row")}>
            <Blurb text="row: natural width" />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View onLayout={layout("picture quiet")}>
            <Picture ref={quiet} name="quiet" />
          </View>
          <View onLayout={layout("picture announced")}>
            <Picture ref={announced} name="announced" />
          </View>
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
