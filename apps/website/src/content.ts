/** Prewritten samples for the homepage. The Swift/Kotlin switcher shows real compiler output for `fixtures/clamp.lucent.ts`. */
export const examples = {
  swift: {
    platform: "iOS",
    extension: ".swift",
    code: "func clamp(\n  value: Double, min: Double, max: Double\n) throws -> Double {\n  if value < min { return min }\n  if value > max { return max }\n  return value\n}",
  },
  kotlin: {
    platform: "Android",
    extension: ".kt",
    code: "fun clamp(\n  value: Double, min: Double, max: Double\n): Double {\n  if (value < min) { return min }\n  if (value > max) { return max }\n  return value\n}",
  },
};

export const source =
  "export function clamp(value: number, min: number, max: number): number {\n  if (value < min) return min;\n  if (value > max) return max;\n  return value;\n}";

export const commands =
  "npx expo install @lucent-lang/core";

export const nativeCard = `import { VStack, Text, TextField, Button,
  type NativeProps, type NativeView } from "@lucent-lang/core/ui";
import type { Event } from "@lucent-lang/core/events";

type Props = {
  title: string;
  name: string;
  onName: Event<string>;
  onPress: Event<void>;
};

export function Card(props: NativeProps<Props>): NativeView {
  return (
    <VStack padding={16} spacing={12}>
      <Text size={20}>{props.title}</Text>
      <TextField value={props.name} onChange={props.onName} />
      <Button title="Continue" onPress={props.onPress} />
    </VStack>
  );
}`;
