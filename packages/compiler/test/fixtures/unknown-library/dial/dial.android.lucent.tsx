import { appContext } from "lucent:android";
import { QXNDial } from "lucent:android/dev.qxn.dials";
import { effect, expose, onDispose } from "lucent:ui";
import type { Props } from "./dial.lucent";

export function Dial(props: Props): QXNDial {
  const dial = new QXNDial(appContext());

  effect(() => {
    dial.qxnLevel = props.level;
  });

  dial.setOnQXNTurnListener((level) => {
    props.onTurn?.(level);
  });

  onDispose(() => {
    dial.setOnQXNTurnListener(null);
  });

  expose({ level: (): number => dial.qxnLevel });

  return dial;
}
