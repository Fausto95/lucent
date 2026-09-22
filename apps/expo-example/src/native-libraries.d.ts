declare module "@lucent-lang/example-counter" {
  import type { NativeView } from "@lucent-lang/ui";
  export function Counter(props: { onChange: (value: number) => void }): NativeView;
}
