import { QXNDial } from "lucent:ios/QXNDials";
// The superclass's module, for the initializers the dial inherits: a module
// only named in others' signatures has none.
// oxlint-disable-next-line import/no-unassigned-import
import "lucent:ios/UIKit";
import { effect, expose, onDispose } from "lucent:ui";
import type { Props } from "./dial.lucent";

export function Dial(props: Props): QXNDial {
  const dial = new QXNDial({ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } });

  effect(() => {
    dial.qxnLevel = props.level;
  });

  dial.qxnOnTurn = (level) => {
    props.onTurn?.(level);
  };

  onDispose(() => {
    dial.qxnOnTurn = null;
  });

  expose({ level: (): number => dial.qxnLevel });

  return dial;
}
