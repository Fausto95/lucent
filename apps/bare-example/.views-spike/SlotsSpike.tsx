// The slots spike's screen: a Card (a native frame holding a native view,
// `inset` in, holding its slot) with React children, which React updates,
// reorders, removes and adds to; a Text child; the native view moving under
// them; the card's padding changing; a Modal child (a portal: its content
// shows in another window); the card unmounted and mounted again (a
// recycled host); a windowed list of cards, scrolled so its cells unmount
// and mount again (recycled hosts); and a windowed list in a card, scrolled
// so its rows come and go: FlatLists, which the app's Metro config keeps on
// its one React Native (TA25). Panels hold their slot below a native header:
// a flex: 1 child must fill the slot (and follow it when an effect grows
// the header), a panel sized by its children must grow by the header,
// and a panel whose slot fills it must lay its child out once, never
// shifting it. After each step
// the card's `inspect` says, from the native views, which children its
// slot holds and where each shows in the host; a `check` line compares that
// with React's children (their tags) and Yoga's frames (their onLayout).
// console.error: the only level a Release build logs.
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  FlatList,
  findNodeHandle,
  type LayoutChangeEvent,
  Modal,
  PixelRatio,
  Platform,
  SafeAreaView,
  Text,
  View,
} from "react-native";
// A relative import is typed as the Lucent component: its React export, as lucent:views/<module> types it.
import * as slots from "./slots.lucent";

type CardRef = {
  inspect(): Promise<string>;
  probe(x: number, y: number): Promise<string>;
  driftLater(dx: number): Promise<void>;
};
type PanelRef = { inspect(): Promise<string> };
type CardProps = {
  title: string;
  inset: number;
  children?: ReactNode;
  style?: object;
  ref?: React.Ref<CardRef>;
};

type PanelProps = {
  header: number;
  children?: ReactNode;
  style?: object;
  ref?: React.Ref<PanelRef>;
};

const { Card, Panel } = slots as unknown as {
  Card: (props: CardProps) => ReactNode;
  Panel: (props: PanelProps) => ReactNode;
};

const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

type Frame = { x: number; y: number; width: number; height: number };

/**
 * What React has for each view it tracks: its tag, and the frame Yoga gave
 * it (onLayout: in its parent's coordinates, the card's for the card's
 * children), with the tracked parent it is in, if any.
 */
const tags = new Map<string, number>();
const frames = new Map<string, Frame>();
const parents = new Map<string, string>();
const instances = new Map<string, View>();
/** Each tracked view's layouts, in order: when (ms since the screen started) and where. */
const layouts = new Map<string, { at: number; frame: Frame }[]>();
const started = Date.now();

function track(name: string, parent?: string) {
  if (parent) parents.set(name, parent);

  return {
    ref: (view: unknown) => {
      const tag = view ? findNodeHandle(view as never) : null;

      if (tag) tags.set(name, tag);
      if (view) instances.set(name, view as View);
    },
    onLayout: (e: LayoutChangeEvent) => {
      const frame = e.nativeEvent.layout;

      frames.set(name, frame);
      layouts.set(name, [...(layouts.get(name) ?? []), { at: Date.now() - started, frame }]);
    },
  };
}

/** Where Yoga put a tracked view, in the card's coordinates. */
function inCard(name: string): Frame | undefined {
  const own = frames.get(name);
  const parent = parents.get(name);

  if (!own || !parent) return own;

  const outer = inCard(parent);

  return outer && { ...own, x: outer.x + own.x, y: outer.y + own.y };
}

/** A panel's `inspect` answer: its slot, in its host's coordinates. */
function panelSlot(answer: string): Frame | undefined {
  const m = /^slot (-?[\d.]+),(-?[\d.]+) ([\d.]+)x([\d.]+)/.exec(answer);

  return m
    ? { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) }
    : undefined;
}

/** Within a physical pixel (and a rounding tenth). */
const near = (a: number, b: number) => Math.abs(a - b) <= 1 / PixelRatio.get() + 0.1;

const rect = (f: Frame | undefined) =>
  f
    ? `${Math.round(f.x * 10) / 10},${Math.round(f.y * 10) / 10} ${Math.round(f.width * 10) / 10}x${Math.round(f.height * 10) / 10}`
    : "none";

/** `name`'s layouts: how many, and when each came. */
const history = (name: string) =>
  (layouts.get(name) ?? []).map((l) => `${rect(l.frame)} at ${l.at} ms`).join(", ");

function Box(props: { name: string; label: string; color: string }) {
  return (
    <View
      {...track(props.name)}
      // A real touch (adb input tap on Android) is logged: it reached the child through the slot.
      onTouchStart={() => log(`touched ${props.name}`)}
      style={{ height: 36, backgroundColor: props.color, margin: 2 }}
    >
      <Text {...track(`${props.name}/text`, props.name)} style={{ padding: 8 }}>
        {props.label}
      </Text>
    </View>
  );
}

const COLORS: Record<string, string> = { A: "#f88", B: "#8f8", C: "#88f" };

/** `children <tag>@<x>,<y> …` of an inspect answer. */
function nativeChildren(answer: string): { tag: number; x: number; y: number }[] {
  const list = answer.split(" children ")[1]?.trim() ?? "";

  return list
    ? list.split(" ").map((c) => {
        const [tag, at] = c.split("@");
        const [x, y] = at!.split(",");

        return { tag: Number(tag), x: Number(x), y: Number(y) };
      })
    : [];
}

/**
 * Whether the slot holds `names`' views in their order, each where Yoga put
 * it (within a pixel). React Native may mount a view's descendants in the
 * card too (a view forming no stacking context has its children hoisted
 * into the nearest one): any other tracked view the slot holds must be
 * where Yoga put it as well, and `extra` views may be untracked (a
 * portal's host view).
 */
function compare(answer: string, names: string[], extra = 0): string {
  const shown = nativeChildren(answer);
  const pixel = 1 / PixelRatio.get() + 0.5;
  const byTag = new Map([...tags].map(([name, tag]) => [tag, name]));
  const where = (s: { x: number; y: number }, name: string) => {
    const f = inCard(name);

    return f !== undefined && Math.abs(s.x - f.x) <= pixel && Math.abs(s.y - f.y) <= pixel;
  };
  const order = shown
    .map((s) => byTag.get(s.tag))
    .filter((n) => n !== undefined && names.includes(n));
  const misplaced = shown.filter((s) => {
    const name = byTag.get(s.tag);

    return name !== undefined && !where(s, name);
  });
  const untracked = shown.filter((s) => !byTag.has(s.tag)).length;
  const ok = order.join() === names.join() && misplaced.length === 0 && untracked === extra;
  const react = [...tags]
    .filter(([name]) => names.includes(name) || names.includes(parents.get(name) ?? ""))
    .map(
      ([name, tag]) =>
        `${name}=${tag}@${Math.round(inCard(name)?.x ?? -1)},${Math.round(inCard(name)?.y ?? -1)}`,
    )
    .join(" ");

  return `${ok ? "pass" : "FAIL"} native [${answer}] react [${react}]`;
}

/** Items 0 to `count`, the data of a list of fixed-size items. */
const indexes = (count: number) => Array.from({ length: count }, (_, i) => i);

/** Where item `index` of a list of `size`-long items is: FlatList need not measure it. */
const fixed = (size: number) => (_: ArrayLike<number> | null | undefined, index: number) => ({
  length: size,
  offset: size * index,
  index,
});

export function SlotsSpike() {
  const card = useRef<CardRef>(null);
  const listCard = useRef<CardRef>(null);
  const panel = useRef<PanelRef>(null);
  const sized = useRef<PanelRef>(null);
  const filled = useRef<PanelRef>(null);
  const [header, setHeader] = useState(40);
  const list = useRef<FlatList<number>>(null);
  const rows = useRef<FlatList<number>>(null);
  const [order, setOrder] = useState(["A", "B", "C"]);
  const [labels, setLabels] = useState<Record<string, string>>({ A: "A", B: "B", C: "C" });
  const [text, setText] = useState(false);
  const [inset, setInset] = useState(8);
  const [padding, setPadding] = useState(12);
  const [portal, setPortal] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const note = (line: string) => {
      log(line);
      setLines((all) => [...all, line]);
    };
    const check = async (step: string, names: string[], extra = 0) => {
      const answer = (await card.current?.inspect()) ?? "no card";

      note(`check ${step}: ${compare(answer, names, extra)}`);
    };
    // A child filling the panel's slot: where Yoga put it is the slot's rectangle.
    const fills = async (step: string, ref: typeof panel, name: string) => {
      const answer = (await ref.current?.inspect()) ?? "no panel";
      const slot = panelSlot(answer);
      const child = frames.get(name);
      const ok =
        slot !== undefined &&
        child !== undefined &&
        near(child.x, slot.x) &&
        near(child.y, slot.y) &&
        near(child.width, slot.width) &&
        near(child.height, slot.height);

      note(
        `check ${step}: ${ok ? "pass" : "FAIL"} slot ${rect(slot)} ${name} ${rect(child)} layouts ${history(name)}`,
      );
    };
    const steps: [number, () => void | Promise<void>][] = [
      [1500, () => check("mount", ["A", "B", "C"])],
      [1600, () => fills("panel header", panel, "PF")],
      [
        1700,
        async () => {
          // Absolutely positioned: from the slot, less the panel's padding (10).
          const slot = panelSlot((await panel.current?.inspect()) ?? "");
          const corner = frames.get("PC");
          const ok = slot && corner && near(corner.x, slot.x - 10) && near(corner.y, slot.y - 10);

          note(`check panel corner: ${ok ? "pass" : "FAIL"} slot ${rect(slot)} PC ${rect(corner)}`);
        },
      ],
      [
        1800,
        async () => {
          // Sized by its children: they fill the slot, which starts below the
          // header and ends at the panel's padding (10).
          const answer = (await sized.current?.inspect()) ?? "no panel";
          const slot = panelSlot(answer);
          const [s1, s2, box] = [frames.get("S1"), frames.get("S2"), frames.get("P2")];
          const ok =
            slot !== undefined &&
            s1 !== undefined &&
            s2 !== undefined &&
            box !== undefined &&
            near(s1.y, slot.y) &&
            near(s2.y + s2.height, slot.y + slot.height) &&
            near(box.height, slot.y + slot.height + 10);

          note(
            `check panel sized: ${ok ? "pass" : "FAIL"} [${answer}] panel ${rect(box)} S1 ${rect(s1)} S2 ${rect(s2)} layouts S1 ${history("S1")}`,
          );
        },
      ],
      [1900, () => fills("panel fill", filled, "FF")],
      [2600, () => setHeader(64)],
      [3300, () => fills("panel grown", panel, "PF")],
      [2000, () => setLabels({ A: "A2", B: "B2", C: "C2" })],
      [2500, () => check("update", ["A", "B", "C"])],
      [3000, () => setOrder(["C", "A", "B"])],
      [3500, () => check("reorder", ["C", "A", "B"])],
      [4000, () => setOrder(["C", "A"])],
      [4500, () => check("remove", ["C", "A"])],
      [5000, () => setText(true)],
      [5500, () => check("text", ["C", "A", "T"])],
      [6000, () => setInset(24)],
      [6500, () => check("native move", ["C", "A", "T"])],
      [7000, () => setPadding(30)],
      [7500, () => check("relayout", ["C", "A", "T"])],
      // The slot moved by a native timer, no commit or command at the time: the
      // children follow it without another layout of the host (TA26).
      [7600, () => card.current?.driftLater(16)],
      [7950, () => check("timer move", ["C", "A", "T"])],
      [
        8000,
        async () => {
          // A touch inside A and inside the slot (which starts `inset` into the
          // card's content, past the card's padding), as UIKit hit-tests it
          // from the host (iOS): A or its text.
          const a = inCard("A");
          const hit = a ? await card.current?.probe(a.x + 40, a.y + 10) : "no frame";
          const inA = [tags.get("A"), tags.get("A/text")].map(String);
          const verdict = inA.includes(hit ?? "") ? "pass" : Platform.OS === "ios" ? "FAIL" : "n/a";

          note(`probe A: ${verdict} hit ${hit} want ${inA.join(" or ")}`);
          instances
            .get("A")
            ?.measureInWindow((x, y) => log(`A in window at ${Math.round(x)},${Math.round(y)}`));
        },
      ],
      [8500, () => setPortal(true)],
      [9500, () => check("portal", ["C", "A", "T"], 1)],
      [10000, () => setPortal(false)],
      [10500, () => check("portal closed", ["C", "A", "T"])],
      [11000, async () => note(`before recycle: ${(await card.current?.inspect()) ?? "none"}`)],
      [11500, () => setMounted(false)],
      [
        12000,
        () => {
          setMounted(true);
          setGeneration(1);
        },
      ],
      [
        13000,
        async () => {
          note(`after recycle: ${(await card.current?.inspect()) ?? "none"}`);
          await check("recycled", ["C", "A", "T"]);
        },
      ],
      [13500, () => list.current?.scrollToEnd({ animated: false })],
      [14500, () => list.current?.scrollToOffset({ offset: 0, animated: false })],
      [15500, async () => note(`list card: ${(await listCard.current?.inspect()) ?? "none"}`)],
      [16000, () => rows.current?.scrollToOffset({ offset: 60 * 24, animated: false })],
      [
        16800,
        () => {
          const count = layouts.get("FF")?.length ?? 0;

          note(
            `check panel fill no shift: ${count === 1 ? "pass" : "FAIL"} FF layouts ${history("FF")}`,
          );
        },
      ],
      [17000, () => note("done")],
    ];

    const timers = steps.map(([ms, step]) =>
      setTimeout(() => {
        void Promise.resolve(step()).catch((e: unknown) => note(`error ${String(e)}`));
      }, ms),
    );

    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Lucent slots spike</Text>
        {mounted && (
          <Card
            key={generation}
            ref={card}
            title="Trip"
            inset={inset}
            style={{ width: 300, padding, borderWidth: 2, borderColor: "#00f" }}
          >
            {order.map((name) => (
              <Box key={name} name={name} label={labels[name]!} color={COLORS[name]!} />
            ))}
            {text && (
              <Text {...track("T")} style={{ padding: 4 }}>
                A text child
              </Text>
            )}
            {portal && (
              <Modal transparent visible onShow={() => log("portal shown")}>
                <View
                  style={{
                    marginTop: 200,
                    alignSelf: "center",
                    backgroundColor: "#fff",
                    padding: 20,
                  }}
                  onLayout={(e) =>
                    log(`portal content laid out ${Math.round(e.nativeEvent.layout.width)} wide`)
                  }
                >
                  <Text>In a portal</Text>
                </View>
              </Modal>
            )}
          </Card>
        )}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Panel
            ref={panel}
            header={header}
            style={{ width: 170, height: 130, padding: 10, borderWidth: 2, borderColor: "#00f" }}
          >
            <View {...track("PF")} style={{ flex: 1, backgroundColor: "#f8f" }} />
            <View
              {...track("PC")}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 20,
                height: 20,
                backgroundColor: "#000",
              }}
            />
          </Panel>
          <View style={{ gap: 8 }}>
            <View {...track("P2")}>
              <Panel ref={sized} header={40} style={{ width: 170, padding: 10 }}>
                <View {...track("S1")} style={{ height: 30, backgroundColor: "#8f8" }} />
                <View {...track("S2")} style={{ height: 30, backgroundColor: "#88f" }} />
              </Panel>
            </View>
            <Panel ref={filled} header={0} style={{ width: 170, height: 30 }}>
              <View {...track("FF")} style={{ flex: 1, backgroundColor: "#8ff" }} />
            </Panel>
          </View>
        </View>
        <FlatList
          ref={list}
          horizontal
          data={indexes(40)}
          keyExtractor={String}
          getItemLayout={fixed(94)}
          initialNumToRender={6}
          windowSize={3}
          style={{ height: 70, flexGrow: 0 }}
          renderItem={({ item: i }) => (
            <View style={{ width: 94 }}>
              <Card
                ref={i === 0 ? listCard : undefined}
                title={`cell ${i}`}
                inset={4}
                style={{ width: 90, height: 60 }}
              >
                <Text>cell {i}</Text>
              </Card>
            </View>
          )}
        />
        <Card title="list" inset={4} style={{ height: 120 }}>
          <FlatList
            ref={rows}
            data={indexes(100)}
            keyExtractor={String}
            getItemLayout={fixed(24)}
            initialNumToRender={10}
            windowSize={3}
            renderItem={({ item: i }) => (
              <View
                style={{ height: 24 }}
                onLayout={i === 60 ? () => log("windowed: row 60 laid out") : undefined}
              >
                <Text>row {i}</Text>
              </View>
            )}
          />
        </Card>
        {lines.map((line, i) => (
          <Text key={i} style={{ fontSize: 10 }}>
            {line}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}
