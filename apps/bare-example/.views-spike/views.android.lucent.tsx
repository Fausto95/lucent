import { appContext } from "lucent:android";
import { TimeAnimator } from "lucent:android/android.animation";
import { ViewGroup } from "lucent:android/android.view";
import { TextView, ToggleButton } from "lucent:android/android.widget";
import { type Coalesced, effect, expose, native, onDispose, signal } from "lucent:ui";

export function Caption(props: { text: string; detail?: string | null }): TextView {
  const label = native(() => new TextView(appContext()));

  effect(() => {
    label.setText(
      props.detail === null ? props.text : `${props.text} (${props.detail ?? "no detail"})`,
    );
  });

  return label;
}

export function Gauge(props: {
  value: number;
  label?: string | null;
  onChange?: (value: number, source?: string) => void;
  onReset?: () => void;
}): TextView {
  const text = native(() => new TextView(appContext()));
  // Setup runs once per mount: its own count goes on across commits.
  let runs = 0;

  effect(() => {
    runs++;
    text.setText(`${props.label ?? "gauge"}: ${props.value}`);
    props.onChange?.(props.value, `effect run ${runs}`);
  });

  expose({
    reset: () => {
      text.setText(`${props.label ?? "gauge"}: reset`);
      props.onReset?.();
    },
    measure: (unit: "pt" | "px"): number => (unit === "pt" ? props.value * 2 : props.value),
    // What the screen shows, as the mount applied the latest commit.
    shown: (): string => text.getText()?.toString() ?? "",
    // The React Native view hosting this mount, named the first time it is
    // asked (React Native sets no content description on it): a recycled
    // view keeps its name, and gets the new mount's id (its tag).
    host: (): string => {
      const parent = text.getParent();

      if (parent === null) return "none";

      const host = parent as ViewGroup;

      if (host.getContentDescription() === null) host.setContentDescription(`view-${Date.now()}`);

      return `${host.getContentDescription()?.toString() ?? "?"} tag=${host.getId()}`;
    },
  });

  return text;
}

export function Meter(props: {
  title: string;
  subtitle?: string | null;
  onChange?: (selected: boolean) => void;
}): ToggleButton {
  const toggle = native(() => new ToggleButton(appContext()));
  const selected = signal(false);
  const changes = signal(0);

  effect(() => {
    toggle.setTextOff(props.title);
  });

  effect(() => {
    toggle.setTextOn(props.subtitle ?? `${changes.get()} changes`);
  });

  toggle.setOnCheckedChangeListener((_button, checked) => {
    selected.set(checked);
  });

  onDispose(() => {
    toggle.setOnCheckedChangeListener(null);
  });

  // JavaScript hears of each change of selection, not of the first value.
  let first = true;
  effect(() => {
    const now = selected.get();

    if (first) {
      first = false;
      return;
    }

    changes.set(changes.peek() + 1);
    props.onChange?.(now);
  });

  expose({
    toggle: () => {
      toggle.setChecked(!toggle.isChecked());
    },
    changes: (): number => changes.peek(),
  });

  return toggle;
}

/**
 * A label a native animator updates every 100 ms or so (on frames, on the
 * main thread), whatever JavaScript is doing. Each tick is logged with its
 * time and sent to JavaScript, which logs when it hears of it.
 */
export function Pulse(props: {
  name: string;
  onTick?: (n: number, at: number) => void;
  onLevel?: Coalesced<(n: number, at: number) => void>;
}): TextView {
  const label = native(() => new TextView(appContext()));
  const animator = new TimeAnimator();
  let n = 0;
  let last = 0;

  label.setBackgroundColor(0xff80deea);

  animator.setTimeListener((_animation, _total, _delta) => {
    const at = Date.now();

    if (at - last < 100) return;

    last = at;
    n++;

    label.setText(`${props.name} tick ${n}`);
    console.log(`LUCENT_TICK ${props.name} n=${n} at=${at}`);
    props.onTick?.(n, at);
    props.onLevel?.(n, at);
  });

  animator.start();

  onDispose(() => {
    animator.setTimeListener(null);
    animator.cancel();
  });

  return label;
}
