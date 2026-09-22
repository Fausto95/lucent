import { expect, test } from "vite-plus/test";
import { compile } from "@lucent-lang/compiler";
import { generateKotlin } from "../src/index.ts";

test("emits resource getters and DisposableEffect lifecycle via Doc", () => {
  const result = compile(
    `import { Text, type NativeView } from "@lucent-lang/core/ui";
import { NativeResource } from "@lucent-lang/core/resources";
export function Panel(): NativeView {
  const slot = resource(() => new NativeResource());
  effect(() => {
    slot.beginOperation();
    return () => { slot.endOperation(); };
  }, [slot]);
  return <Text>ok</Text>;
}`,
    { fileName: "panel.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const code = generateKotlin(result.module!).code;
  expect(code).toContain("lucentGet_slot:");
  expect(code).toContain("DisposableEffect");
  expect(code).toContain("onDispose");
  expect(code).toContain("beginOperation");
  expect(code).toContain("endOperation");
});

test("emits LucentEffectRunner via LaunchedEffect for async effects", () => {
  const result = compile(
    `import { Text, type NativeView } from "@lucent-lang/core/ui";
import { NativeResource } from "@lucent-lang/core/resources";
export function Panel(): NativeView {
  const slot = resource(() => new NativeResource());
  effect(async () => {
    slot.beginOperation();
    return async () => { slot.endOperation(); };
  }, [slot]);
  return <Text>ok</Text>;
}`,
    { fileName: "panel-async.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const code = generateKotlin(result.module!).code;
  expect(code).toContain("LaunchedEffect");
  expect(code).toContain("LucentEffectRunner.run");
  expect(code).toContain("beginOperation");
  expect(code).toContain("endOperation");
});
