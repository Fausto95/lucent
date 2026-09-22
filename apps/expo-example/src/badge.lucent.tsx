import { Text, type NativeProps, type NativeView } from "@lucent-lang/ui";
type Props = { title: string };
export function Badge(props: NativeProps<Props>): NativeView {
  return (
    <Text size={26} color="#e7f6ef">
      {props.title}
    </Text>
  );
}
