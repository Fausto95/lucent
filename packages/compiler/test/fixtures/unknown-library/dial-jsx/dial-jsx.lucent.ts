import type { UIView } from "lucent:ios/UIKit";
import type { View } from "lucent:android/android.view";

export type Props = {
  level: number;
  onTurn?: (level: number) => void;
};

/** The library's dial written as JSX (T48): its attributes derived by rule from its declarations. */
export declare function Dial(props: Props): UIView | View;
