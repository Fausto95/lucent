// The players spike's module, in expo-video's shape: a class JavaScript
// makes keeps a native object (a label standing in for a video player) in
// a map only main-thread code uses, under its id, and a view shows the
// one whose id it takes as a prop, as Expo's VideoView does. JavaScript
// renames a player through main() and the view shows it without a
// render. Its plain functions take a rest parameter and an ArrayBuffer
// through the app's real JSI.
import { appContext } from "lucent:android";
import { FrameLayout, TextView } from "lucent:android/android.widget";
import { ViewGroup } from "lucent:android/android.view";
import { NSTextAlignment, UILabel, UIView, UIView_AutoresizingMask } from "lucent:ios/UIKit";
import { PLATFORM } from "lucent:platform";
import { main } from "lucent:thread";
import { effect } from "lucent:ui";

const iosLabels = new Map<number, UILabel>();
const androidLabels = new Map<number, TextView>();
let next = 0;

export class Player {
  readonly id = next++;

  constructor(title: string) {
    const id = this.id;

    if (PLATFORM === "ios")
      void main(() => {
        const label = new UILabel();

        label.text = title;
        label.textAlignment = NSTextAlignment.center;
        iosLabels.set(id, label);
      });
    else
      void main(() => {
        const label = new TextView(appContext());

        label.setText(title);
        androidLabels.set(id, label);
      });
  }

  rename(title: string): void {
    const id = this.id;

    if (PLATFORM === "ios")
      void main(() => {
        const label = iosLabels.get(id);

        if (label) label.text = title;
      });
    else
      void main(() => {
        androidLabels.get(id)?.setText(title);
      });
  }

  [Symbol.dispose](): void {
    const id = this.id;

    if (PLATFORM === "ios")
      void main(() => {
        iosLabels.get(id)?.removeFromSuperview();
        iosLabels.delete(id);
      });
    else
      void main(() => {
        const label = androidLabels.get(id);
        const parent = label?.getParent();

        if (label && parent instanceof ViewGroup) parent.removeView(label);
        androidLabels.delete(id);
      });
  }
}

/** Shows the label of the player whose id it takes. */
export function PlayerView(props: { player: number }) {
  if (PLATFORM === "ios") {
    const view = new UIView();

    effect(() => {
      const label = iosLabels.get(props.player);

      if (!label) return;

      label.frame = view.bounds;
      label.autoresizingMask =
        UIView_AutoresizingMask.flexibleWidth | UIView_AutoresizingMask.flexibleHeight;
      view.addSubview(label);
    });

    return view;
  }

  const frame = new FrameLayout(appContext());

  effect(() => {
    const label = androidLabels.get(props.player);
    const parent = label?.getParent();

    if (!label) return;

    if (parent instanceof ViewGroup) parent.removeView(label);
    frame.addView(label);
  });

  return frame;
}

export function joined(...words: string[]): string {
  return words.join(" ");
}

export function checksum(buffer: ArrayBuffer): number {
  return new Uint8Array(buffer).reduce((a, b) => (a * 31 + b) % 65521, 1);
}

export function filled(n: number, value: number): ArrayBuffer {
  return new Uint8Array(n).fill(value).buffer;
}
