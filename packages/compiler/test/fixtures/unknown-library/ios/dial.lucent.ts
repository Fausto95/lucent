import type { QXNDial } from "lucent:ios/QXNDials";
import type { View } from "lucent:android/android.view";

export type Props = {
  level: number;
  onTurn?: (level: number) => void;
};

/** The library's dial as a component: its level from props, its turns as events. */
export declare function Dial(props: Props): QXNDial | View;
