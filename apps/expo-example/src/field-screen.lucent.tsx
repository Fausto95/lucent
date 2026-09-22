import type { Event } from "@lucent-lang/events";
import {
  Background,
  Button,
  CornerRadius,
  Divider,
  For,
  HStack,
  Padding,
  ScrollView,
  Slider,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  type NativeProps,
  type NativeView,
} from "@lucent-lang/ui";
import { Badge } from "./badge.lucent";

type Props = {
  title: string;
  notes: string[];
  onRecord: Event<void>;
};

export function FieldScreen(props: NativeProps<Props>): NativeView {
  const draft = state("Ridge line");
  const gain = state(35);
  const armed = state(true);
  return (
    <ScrollView>
      <Background color="#10221c">
        <CornerRadius value={22}>
          <Padding value={18}>
            <VStack spacing={12}>
              <Badge title={props.title} />
              <Text size={15} color="#8fb9a8">
                {armed ? "Receiver armed" : "Receiver paused"}
              </Text>
              <Divider />
              {props.notes.length === 0 ? (
                <Text color="#8fb9a8">No samples yet</Text>
              ) : (
                <For each={props.notes}>
                  {(note: string) => (
                    <HStack spacing={8}>
                      <Text color="#d7efe4">{note}</Text>
                      <Spacer />
                    </HStack>
                  )}
                </For>
              )}
              <TextField value={draft} onChange={(value: string) => draft.set(value)} placeholder="Sample label" />
              <Toggle title="Arm receiver" value={armed} onChange={(value: boolean) => armed.set(value)} />
              <Slider value={gain} min={0} max={100} onChange={(value: number) => gain.set(value)} />
              <HStack spacing={8}>
                <Text size={13} color="#c4f778">
                  {draft}
                </Text>
                <Spacer />
                <Text size={13} color="#8fb9a8">
                  {gain}
                </Text>
              </HStack>
              <Button title="Record sample" onPress={props.onRecord} />
            </VStack>
          </Padding>
        </CornerRadius>
      </Background>
    </ScrollView>
  );
}
