import { Text, VStack, type NativeView } from "@lucent-lang/ui";

type Props = { title: string; children: NativeView };

/** A Lucent-only component: it takes its content through a typed child slot. */
export function Panel(props: Props): NativeView {
  return (
    <VStack spacing={6}>
      <Text size={12} color="#8fb9a8">
        {props.title}
      </Text>
      {props.children}
    </VStack>
  );
}
