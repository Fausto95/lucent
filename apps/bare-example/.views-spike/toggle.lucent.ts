// The toggle spike's component, declared for every platform: a toggle
// whose view is written in Lucent with the platform's declarative UI
// (SwiftUI in toggle.ios.lucent.tsx, Jetpack Compose in
// toggle.android.lucent.tsx), with a counter of its flips. A tap, its
// `toggle` command or, while `auto`, a native timer flips it; `pulse`
// scales it. Internal, like the views spike (scripts/views-spike.ts
// --entry toggle.js).
import type { ComposeView } from "lucent:compose";
import type { UIHostingController } from "lucent:swiftui";

export type ToggleProps = {
  title: string;
  /** Flipped by a native timer every 800 ms. */
  auto?: boolean;
  /** Each flip: the new state, the flips so far, and when (the main thread's time). */
  onChange?: (on: boolean, taps: number, at: number) => void;
};

export declare function Toggle(props: ToggleProps): UIHostingController | ComposeView;
