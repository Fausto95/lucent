/**
 * The roadmap's native-wrapper fixture, on real SDK views: a toggle button
 * whose title props effects keep showing (the selected title falls back to
 * a signal of its own), whose native state-change callback, subscribed
 * once, feeds a signal that an effect turns into `onChange` events, which
 * unsubscribes when the view goes, and which exposes `reset()` and
 * `changes()` to its React ref.
 */

export const METER = {
  "meter.lucent.ts": `import type { UIButton } from "lucent:ios/UIKit";
import type { ToggleButton } from "lucent:android/android.widget";

export type Props = {
  title: string;
  subtitle?: string | null;
  onChange?: (selected: boolean) => void;
};

export declare function Meter(props: Props): UIButton | ToggleButton;
`,
  "meter.ios.lucent.tsx": `import { UIButton, UIControl_State } from "lucent:ios/UIKit";
import { effect, expose, onDispose, signal } from "lucent:ui";
import type { Props } from "./meter.lucent";

export function Meter(props: Props): UIButton {
  const button = new UIButton({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });
  const selected = signal(false);
  const changes = signal(0);

  button.changesSelectionAsPrimaryAction = true;

  effect(() => {
    button.setTitle(props.title, UIControl_State.normal);
  });

  effect(() => {
    button.setTitle(props.subtitle ?? \`\${changes.get()} changes\`, UIControl_State.selected);
  });

  // UIKit calls it on the main thread whenever the button's state changes.
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
    reset: () => {
      button.isSelected = false;
      selected.set(false);
    },
    changes: (): number => changes.peek(),
  });

  return button;
}
`,
  "meter.android.lucent.tsx": `import { appContext } from "lucent:android";
import { ToggleButton } from "lucent:android/android.widget";
import { effect, expose, onDispose, signal } from "lucent:ui";
import type { Props } from "./meter.lucent";

export function Meter(props: Props): ToggleButton {
  const toggle = new ToggleButton(appContext());
  const selected = signal(false);
  const changes = signal(0);

  effect(() => {
    toggle.setTextOff(props.title);
  });

  effect(() => {
    toggle.setTextOn(props.subtitle ?? \`\${changes.get()} changes\`);
  });

  // Android calls it on the main thread whenever the button is checked or not.
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
    reset: () => {
      toggle.setChecked(false);
    },
    changes: (): number => changes.peek(),
  });

  return toggle;
}
`,
};
