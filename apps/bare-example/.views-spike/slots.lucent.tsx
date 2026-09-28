// The slots spike's components: a card taking React children, which it
// shows in its slot, inside a native view `inset` points in from its own
// edges. Its `inspect` request says, from the native views, where each
// child in its slot shows in its host; `probe` (iOS) which view a touch at
// a point of its host reaches. A panel shows a native header `header`
// points tall above its slot (none: the slot fills it); its `inspect` says
// where the slot and each child in it are in its host. Internal, like the
// views spike (scripts/views-spike.ts --entry slots.js).
import type { FrameLayout } from "lucent:android/android.widget";
import type { UIView } from "lucent:ios/UIKit";
import type { Children } from "lucent:ui";

export declare function Card(props: {
  title: string;
  inset: number;
  children?: Children;
}): UIView | FrameLayout;

export declare function Panel(props: { header: number; children?: Children }): UIView | FrameLayout;
