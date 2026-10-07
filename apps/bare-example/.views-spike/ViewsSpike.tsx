// The view spike's screen: two component types with two instances each
// (Gauge, Meter), a Caption and three Pulses (labels a native timer
// updates: A and B send each tick, C only its coalesced level). Their props change (reaching their setups' effects, never
// running setup again), their events reach JavaScript, their commands
// (void ones and requests) run; the second Gauge and Pulse unmount and
// mount again on the views React Native recycles; a burst of commits
// each changes one prop; then JavaScript blocks, a compute task runs, and
// module code holds the Lucent lock while the Pulses go on. Each step
// logs a LUCENT_VIEWS line (JavaScript's time in `at=`), each native tick
// a LUCENT_TICK line (the main thread's). A request in flight when its
// view unmounts rejects (AbortError), and the unmounted view's ref
// refuses commands (InvalidStateError).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SafeAreaView, Text, type TurboModule, TurboModuleRegistry, View } from "react-native";
// A relative import is typed as the Lucent component: its React export, as lucent:views/<module> types it.
import * as views from "./views.lucent";
import { isolated, locked, starts } from "./work.lucent";

type GaugeRef = {
  reset(): void;
  measure(unit: "pt" | "px"): Promise<number>;
  shown(): Promise<string>;
  host(): Promise<string>;
};
type MeterRef = { toggle(): void; changes(): Promise<number> };

type DevSettingsModule = TurboModule & { reload(): void };

type GaugeProps = {
  value: number;
  label?: string | null;
  onChange?: (value: number, source?: string) => void;
  onReset?: () => void;
  style?: object;
  ref?: React.Ref<GaugeRef>;
};

const { Caption, Gauge, Meter, Pulse } = views as unknown as {
  Caption: (props: { text: string; detail?: string | null }) => React.ReactNode;
  Gauge: (props: GaugeProps) => React.ReactNode;
  Meter: (props: {
    title: string;
    subtitle?: string | null;
    onChange?: (selected: boolean) => void;
    style?: object;
    ref?: React.Ref<MeterRef>;
  }) => React.ReactNode;
  Pulse: (props: {
    name: string;
    onTick?: (n: number, at: number) => void;
    onLevel?: (n: number, at: number) => void;
    style?: object;
  }) => React.ReactNode;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `done` (React committed what was asked): a slow build's
 * stream of events can hold a render back for seconds, and a second
 * state change before it would merge with the first.
 */
async function until(what: string, done: () => boolean) {
  const start = Date.now();

  while (!done()) {
    if (Date.now() - start > 10_000) throw new Error(`${what}: not committed in 10 s`);
    await sleep(50);
  }
}

/** Blocks the JavaScript thread for `ms`. */
function block(ms: number) {
  const end = Date.now() + ms;
  let x = 0;

  while (Date.now() < end) x = (x * 31 + 7) % 1000003;

  return x;
}

const BURST = 20;

/**
 * A Gauge whose props a burst of commits changes, one prop each, in one
 * JavaScript task: each commit's layout effect asks for the next, which
 * React renders and commits before the task ends. Odd steps change the
 * label, even ones the value; the last label is L19, the last value 20.
 */
function Burst({
  run,
  gauge,
  onDone,
}: {
  run: boolean;
  gauge: React.Ref<GaugeRef>;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const task = useRef(0);

  useLayoutEffect(() => {
    if (!run) return;

    // Each commit of the burst, with the JavaScript task it ran in.
    if (step === 0) task.current = Date.now();
    log(`burst commit step=${step} task=${task.current}`);

    // oxlint-disable-next-line react/set-state-in-effect -- each commit asking for the next is the burst
    if (step < BURST) setStep(step + 1);
    else onDone();
  }, [run, step, onDone]);

  const label = step === 0 ? "burst" : `L${step % 2 ? step : step - 1}`;
  const value = step % 2 ? step - 1 : step;

  // The mount's effect runs once per commit it applies.
  const applied = (v: number, source?: string) => log(`burst applied value=${v} ${source}`);

  return (
    <Gauge ref={gauge} value={value} label={label} onChange={applied} style={{ height: 30 }} />
  );
}

export function ViewsSpike() {
  const first = useRef<GaugeRef>(null);
  const second = useRef<GaugeRef>(null);
  const burst = useRef<GaugeRef>(null);
  const burstDone = useRef(false);
  const meter = useRef<MeterRef>(null);
  const meter2 = useRef<MeterRef>(null);
  const [value, setValue] = useState(1);
  const [shown, setShown] = useState(true);
  const [mounts, setMounts] = useState(1);
  const [bursting, setBursting] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [run] = useState(() => starts());

  const note = (line: string) => {
    log(line);
    setLines((all) => [...all.slice(-14), line]);
  };

  useEffect(() => {
    // The effect's own: it runs once.
    const note = (line: string) => {
      log(line);
      setLines((all) => [...all.slice(-14), line]);
    };

    const request = async <T,>(what: string, ask: () => Promise<T>) => {
      try {
        note(`${what}=${String(await ask())}`);
      } catch (e) {
        note(`${what} failed: ${String(e)}`);
      }
    };

    const phase = async (name: string, work: () => Promise<unknown> | unknown) => {
      log(`phase ${name} start at=${Date.now()}`);
      const out = await work();
      log(`phase ${name} end at=${Date.now()}${out === undefined ? "" : ` out=${String(out)}`}`);
      await sleep(600);
    };

    let cancelled = false;

    const script = async () => {
      note(`run ${run} (JavaScript starts in this process) dev=${__DEV__}`);
      await sleep(800);

      note("update value=2");
      setValue(2);
      await sleep(800);

      note("command reset");
      first.current?.reset();
      await sleep(800);

      await request("request measure pt", () => first.current!.measure("pt"));
      await request("request measure px", () => second.current!.measure("px"));
      await sleep(400);

      note("command toggle meter, meter2");
      meter.current?.toggle();
      meter2.current?.toggle();
      await sleep(800);

      // Toggled again in a later turn: UIKit updates a button's
      // configuration once per turn, whatever changed in it.
      note("command toggle meter2");
      meter2.current?.toggle();
      await sleep(800);

      await request("request meter changes", () => meter.current!.changes());
      await request("request meter2 changes", () => meter2.current!.changes());

      if (run > 1) {
        note("after reload: done");
        return;
      }

      await request("request host before", () => second.current!.host());

      // Asked, then unmounted before the answer can reach JavaScript.
      const late = second.current!.measure("px").then(
        (v) => `answered ${v}`,
        (e) => `rejected ${String(e)}`,
      );

      const stale = second.current!;

      note("unmount second, pulse B");
      setShown(false);
      note(`request in flight at unmount: ${await late}`);
      await until("unmount", () => second.current === null);
      await request("request to the unmounted view", () => stale.measure("px"));
      await sleep(800);

      note("mount second, pulse B again");
      setMounts((m) => m + 1);
      setShown(true);
      await until("mount", () => second.current !== null);
      await sleep(400);

      await request("request host after", () => second.current!.host());
      await request("request measure again px", () => second.current!.measure("px"));
      await sleep(400);

      note("burst");
      setBursting(true);
      await until("burst", () => burstDone.current);
      await sleep(800);
      await request(`request burst shown (expect L${BURST - 1}: ${BURST})`, () =>
        burst.current!.shown(),
      );

      await phase("js-block", () => block(3000));
      await phase("compute", async () => (await isolated(500)).slice(0, 2).join("-"));
      await phase("lucent-lock", () => locked(1000).slice(0, 2).join("-"));
      await phase("both", async () => {
        const task = isolated(500);

        block(2000);

        return (await task).slice(0, 2).join("-");
      });

      note("isolation done");

      // A development build starts JavaScript again (a new runtime, the
      // same process); a release build does nothing. Asked of the native
      // module: DevSettings does nothing in a bundle built without __DEV__.
      if (!cancelled) {
        note("reload");
        await sleep(300);
        TurboModuleRegistry.get<DevSettingsModule>("DevSettings")?.reload();
      }
    };

    script().catch((e) => note(`script failed: ${String(e)}`));

    return () => {
      cancelled = true;
    };
  }, [run]);

  const tick = (name: string, mount: number) => (n: number, at: number) =>
    log(`tick-rx ${name} mount=${mount} n=${n} at=${at} rx=${Date.now()}`);

  // Coalesced: while JavaScript is busy, only the latest level waits.
  const level = (name: string) => (n: number, at: number) =>
    log(`level-rx ${name} n=${n} at=${at} rx=${Date.now()}`);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Lucent views spike (run {run})</Text>
        <Caption text="caption" detail={null} />
        <Pulse name="A" onTick={tick("A", 1)} style={{ height: 30 }} />
        <Pulse name="C" onLevel={level("C")} style={{ height: 30 }} />
        <Gauge
          ref={first}
          value={value}
          label="first"
          onChange={(v, source) => note(`event first onChange value=${v} source=${source}`)}
          onReset={() => note("event first onReset")}
          style={{ height: 30 }}
        />
        <Meter
          ref={meter}
          title="off"
          onChange={(selected) => note(`event meter onChange selected=${selected}`)}
          style={{ height: 36 }}
        />
        <Meter
          ref={meter2}
          title="off 2"
          onChange={(selected) => note(`event meter2 onChange selected=${selected}`)}
          style={{ height: 36 }}
        />
        {shown ? (
          <Gauge
            ref={second}
            value={value * 10}
            onChange={(v, source) =>
              note(`event second mount=${mounts} onChange value=${v} source=${source}`)
            }
            style={{ height: 30 }}
          />
        ) : null}
        {shown ? (
          <Pulse name={`B${mounts}`} onTick={tick("B", mounts)} style={{ height: 30 }} />
        ) : null}
        <Burst
          run={bursting}
          gauge={burst}
          onDone={() => {
            burstDone.current = true;
          }}
        />
        {lines.map((line, i) => (
          <Text key={i} style={{ fontSize: 11 }}>
            {line}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}
