import { Text, type NativeProps, type NativeView } from "@lucent-lang/ui";
type Props = { title: string };
export function Badge(props: NativeProps<Props>): NativeView {
  return (
    <Text size={20} color="#38745E">
      {props.title}
    </Text>
  );
}
