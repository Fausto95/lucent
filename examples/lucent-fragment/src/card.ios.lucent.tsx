// iOS has no fragments: the card is a label.
import { UILabel } from "lucent:ios/UIKit";
import type { CardProps } from "./card.lucent";

export function Card(props: CardProps): UILabel {
  return <UILabel text={props.text} />;
}

export async function cardShown(): Promise<string> {
  return "none";
}
