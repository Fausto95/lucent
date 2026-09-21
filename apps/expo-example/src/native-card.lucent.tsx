import { Column, Button, type NativeProps, type NativeView } from "@lucent-lang/ui";
import type { Event } from "@lucent-lang/events";
import { Badge } from "./badge.lucent";
type Props = { title: string; onPress: Event<void> };
export function NativeCard(props: NativeProps<Props>): NativeView {
  return (
    <Column padding={16} spacing={12}>
      <Badge title={props.title} />
      <Button title="Native button" onPress={props.onPress} />
    </Column>
  );
}
