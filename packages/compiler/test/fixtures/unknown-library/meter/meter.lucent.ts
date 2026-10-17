// A component of the panel library's views, its props, events and children
// of types the app declares: every name is drawn at random on every run.
import type { View } from "lucent:android/android.view";
import type { Children } from "lucent:ui";

/** The gauge's scale: a record of the app's, an array among its fields. */
export type QXNScale = { qxnFrom: number; qxnMarks: number[] };

/** How finely the gauge reads: a union of strings. */
export type QXNMode = "qxnFine" | "qxnCoarse";

/** What a turn reports: a record. */
export type QXNTurned = { qxnLevel: number; qxnLabel: string; qxnSteps: number };

export type Props = {
  qxnScale: QXNScale;
  qxnMode?: QXNMode;
  qxnLabels: string[];
  onQxnTurned?: (turned: QXNTurned) => void;
  children?: Children;
};

/** A panel of the library's: its gauge reads the scale, turns become events, children go below it. */
export declare function QXNMeter(props: Props): View;
