import {
  UIButton,
  UIButton_Configuration,
  UIColor,
  UIControl_State,
  UILabel,
} from "lucent:ios/UIKit";
import { Timer } from "lucent:ios/Foundation";
import { type Coalesced, effect, expose, onDispose, signal } from "lucent:ui";

export function Caption(props: { text: string; detail?: string | null }): UILabel {
  const label = new UILabel();

  effect(() => {
    label.text =
      props.detail === null ? props.text : `${props.text} (${props.detail ?? "no detail"})`;
  });

  return label;
}

export function Gauge(props: {
  value: number;
  label?: string | null;
  onChange?: (value: number, source?: string) => void;
  onReset?: () => void;
}): UILabel {
  const text = new UILabel();
  // Setup runs once per mount: its own count goes on across commits.
  let runs = 0;

  text.backgroundColor = UIColor.systemYellow;

  effect(() => {
    runs++;
    text.text = `${props.label ?? "gauge"}: ${props.value}`;
    props.onChange?.(props.value, `effect run ${runs}`);
  });

  expose({
    reset: () => {
      text.text = `${props.label ?? "gauge"}: reset`;
      props.onReset?.();
    },
    measure: (unit: "pt" | "px"): number => (unit === "pt" ? props.value * 2 : props.value),
    // What the screen shows, as the mount applied the latest commit.
    shown: (): string => text.text ?? "",
    // The React Native view hosting this mount, named the first time it is
    // asked (React Native leaves its restoration identifier alone): a
    // recycled view keeps its name, and gets the new mount's tag.
    host: (): string => {
      const host = text.superview;

      if (host === null) return "none";

      if (host.restorationIdentifier === null) host.restorationIdentifier = `view-${Date.now()}`;

      return `${host.restorationIdentifier} tag=${host.tag}`;
    },
  });

  return text;
}

export function Meter(props: {
  title: string;
  subtitle?: string | null;
  onChange?: (selected: boolean) => void;
}): UIButton {
  const button = new UIButton({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  const selected = signal(false);
  const changes = signal(0);

  // A configured button: UIKit calls its update handler as its state changes.
  button.configuration = UIButton_Configuration.gray();
  button.changesSelectionAsPrimaryAction = true;

  effect(() => {
    button.setTitle(props.title, UIControl_State.normal);
  });

  effect(() => {
    button.setTitle(props.subtitle ?? `${changes.get()} changes`, UIControl_State.selected);
  });

  button.configurationUpdateHandler = (b) => {
    selected.set(b.isSelected);
  };

  onDispose(() => {
    button.configurationUpdateHandler = null;
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
      button.isSelected = !button.isSelected;
    },
    changes: (): number => changes.peek(),
  });

  return button;
}

/**
 * A label a native timer updates every 100 ms on the main thread, whatever
 * JavaScript is doing. Each tick is logged with its time and sent to
 * JavaScript, which logs when it hears of it.
 */
export function Pulse(props: {
  name: string;
  onTick?: (n: number, at: number) => void;
  onLevel?: Coalesced<(n: number, at: number) => void>;
}): UILabel {
  const label = new UILabel();
  let n = 0;

  label.backgroundColor = UIColor.systemTeal;

  const timer = Timer.scheduledTimer(0.1, true, (_timer) => {
    n++;

    const at = Date.now();

    label.text = `${props.name} tick ${n}`;
    console.log(`LUCENT_TICK ${props.name} n=${n} at=${at}`);
    props.onTick?.(n, at);
    props.onLevel?.(n, at);
  });

  onDispose(() => {
    timer.invalidate();
  });

  return label;
}
