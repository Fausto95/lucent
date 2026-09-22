import { Counter } from "@lucent-lang/example-counter";
import { VStack, Button, TextField, Toggle, Slider, type NativeProps, type NativeView } from "@lucent-lang/ui";
import type { Event } from "@lucent-lang/events";
import { Badge } from "./badge.lucent";
type Props = {
  title: string;
  onPress: Event<void>;
  text: string;
  onText: Event<string>;
  enabled: boolean;
  onEnabled: Event<boolean>;
  amount: number;
  onAmount: Event<number>;
  onCount: Event<number>;
};
export function NativeCard(props: NativeProps<Props>): NativeView {
  return (
    <VStack padding={16} spacing={12}>
      <Badge title={props.title} />
      <TextField value={props.text} onChange={props.onText} placeholder="Native input" />
      <Toggle title="Native toggle" value={props.enabled} onChange={props.onEnabled} />
      <Slider value={props.amount} min={0} max={100} onChange={props.onAmount} />
      <Counter onChange={props.onCount} />
      <Button title="Native button" onPress={props.onPress} />
    </VStack>
  );
}
