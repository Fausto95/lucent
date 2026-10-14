// iOS has no fragments: the card is a label.
import { UILabel, type UIView } from "lucent:ios/UIKit";
import type { CardProps } from "./card.lucent";

export function Card(props: CardProps): UIView {
  return <UILabel text={props.text} />;
}

export async function cardShown(): Promise<string> {
  return "none";
}
