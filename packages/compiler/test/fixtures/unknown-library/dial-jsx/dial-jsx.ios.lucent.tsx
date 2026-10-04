import { QXNDial } from "lucent:ios/QXNDials";
import type { UIView } from "lucent:ios/UIKit";
import type { Props } from "./dial-jsx.lucent";

export function Dial(props: Props): UIView {
  return <QXNDial qxnLevel={props.level} qxnOnTurn={(level) => props.onTurn?.(level)} />;
}
