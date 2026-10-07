// The view spike's components: a label (Caption), a control (Gauge), a
// toggle (Meter, the roadmap's native wrapper) and a label a native timer
// updates (Pulse, whose ticks go discretely or coalesced), with props,
// events, commands and requests. Built by scripts/views-spike.ts, which
// copies this directory into the app for its build.
import type { TextView, ToggleButton } from "lucent:android/android.widget";
import type { UIButton, UILabel } from "lucent:ios/UIKit";
import type { Coalesced } from "lucent:ui";

export declare function Caption(props: {
  text: string;
  detail?: string | null;
}): UILabel | TextView;

export declare function Gauge(props: {
  value: number;
  label?: string | null;
  onChange?: (value: number, source?: string) => void;
  onReset?: () => void;
}): UILabel | TextView;

export declare function Meter(props: {
  title: string;
  subtitle?: string | null;
  onChange?: (selected: boolean) => void;
}): UIButton | ToggleButton;

export declare function Pulse(props: {
  name: string;
  onTick?: (n: number, at: number) => void;
  onLevel?: Coalesced<(n: number, at: number) => void>;
}): UILabel | TextView;
