import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
test("type checks native event declarations and emission", () => {
  const source = `import { event } from "@lucent-lang/events";
    type Progress = { percent: number };
    export const progress = event<Progress>();
    export function run(): void { progress.emit({percent: 50}); }`;
  const result = compile(source, { fileName: "progress.lucent.ts" });
  expect(result.diagnostics).toEqual([]);
  expect(result.module?.events).toHaveLength(1);
  expect(
    compile(source.replace("percent: 50", 'percent: "bad"'), { fileName: "progress.lucent.ts" }).diagnostics.length,
  ).toBeGreaterThan(0);
});
test("native views accept typed event props", () => {
  const result = compile(
    `import { Button, type NativeView } from "@lucent-lang/ui";
    import type { Event } from "@lucent-lang/events";
    type Props = { onPress: Event<void> };
    export function Action(props: Props): NativeView { return <Button title="Run" onPress={props.onPress} />; }`,
    { fileName: "action.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
});
