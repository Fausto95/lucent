import { appContext } from "lucent:android";
import { QXNDial } from "lucent:android/dev.qxn.dials";
import { effect, expose, onDispose } from "lucent:ui";
import type { Props } from "./dial.lucent";

export function Dial(props: Props): QXNDial {
  const dial = new QXNDial(appContext());

  effect(() => {
    dial.qxnLevel = props.level;
  });

  dial.qxnSetOnTurn((level) => {
    props.onTurn?.(level);
  });

  onDispose(() => {
    dial.qxnSetOnTurn(null);
  });

  expose({ level: (): number => dial.qxnLevel });

  return dial;
}
