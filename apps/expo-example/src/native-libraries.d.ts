declare module "@lucent-lang/example-counter" {
  import type { NativeView } from "@lucent-lang/ui";
  export function Counter(props: { onChange: (value: number) => void }): NativeView;
}
declare module "@lucent-lang/example-toolkit" {
  export function sha256(bytes: Uint8Array): string;
  export function temporaryDirectory(): Promise<string>;
  export function writeFile(path: string, bytes: Uint8Array): Promise<void>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function deviceModel(): Promise<string>;
}
