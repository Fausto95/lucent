import { QXNDial } from "lucent:android/dev.qxn.dials";
import type { View } from "lucent:android/android.view";
import type { Props } from "./dial-jsx.lucent";

export function Dial(props: Props): View {
  return (
    <QXNDial
      qxnLevel={props.level}
      onQXNTurn={(level) => props.onTurn?.(level)}
      qxnOnSpin={(level) => props.onTurn?.(level)}
      qxnSettled={(level) => props.onTurn?.(level)}
    />
  );
}
