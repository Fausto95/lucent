import { expect, test } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { printIR } from "../src/ir/print.ts";

const header = `import { Text, Button, type NativeView } from "@lucent-lang/core/ui";
import { NativeResource } from "@lucent-lang/core/resources";
`;

test("resource() declares an owned slot initialized once per view identity", () => {
  const result = compile(
    `${header}
export function Panel(): NativeView {
  const slot = resource(() => new NativeResource());
  return <Button title="Touch" onPress={() => slot.beginOperation()} />;
}`,
    { fileName: "panel.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const fn = result.module?.functions.find((item) => item.name === "Panel");
  expect(fn?.resources).toHaveLength(1);
  expect(fn?.resources?.[0]?.name).toBe("slot");
  expect(fn?.resources?.[0]?.initCallee).toMatch(/NativeResource__create$/);
  expect(fn?.resources?.[0]?.close).toBe("close");
  expect(printIR(result.module!)).toContain("resource slot");
  expect(JSON.stringify(fn?.body)).toContain('"op":"resourceRead"');
});

test("effect() records sync setup and cleanup on the view", () => {
  const result = compile(
    `${header}
export function Panel(): NativeView {
  const slot = resource(() => new NativeResource());
  effect(() => {
    slot.beginOperation();
    return () => {
      slot.endOperation();
    };
  }, [slot]);
  return <Text>ok</Text>;
}`,
    { fileName: "panel.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const fn = result.module?.functions.find((item) => item.name === "Panel");
  expect(fn?.effectSlots).toHaveLength(1);
  expect(fn?.effectSlots?.[0]?.deps).toEqual(["slot"]);
  expect(JSON.stringify(fn?.effectSlots?.[0]?.body)).toContain("beginOperation");
  expect(JSON.stringify(fn?.effectSlots?.[0]?.cleanup)).toContain("endOperation");
});

test("async effect() records async flag and pulls TaskScope runtime", () => {
  const result = compile(
    `${header}
export function Panel(): NativeView {
  const slot = resource(() => new NativeResource());
  effect(async () => {
    slot.beginOperation();
    return async () => {
      slot.endOperation();
    };
  }, [slot]);
  return <Text>ok</Text>;
}`,
    { fileName: "panel-async.lucent.tsx" },
  );
  expect(result.diagnostics).toEqual([]);
  const fn = result.module?.functions.find((item) => item.name === "Panel");
  expect(fn?.effectSlots?.[0]?.async).toBe(true);
  expect(printIR(result.module!)).toContain("effect effect0 async");
  expect(Object.values(result.module!.nativePackages ?? {}).flatMap((p) => Object.keys(p.swift ?? {}))).toContain(
    "Tasks.swift",
  );
});

test("rejects nested or non-closeable resource() and nested effect()", () => {
  const cases = [
    `${header} export function Panel(): NativeView {
  if (true) { const slot = resource(() => new NativeResource()); }
  return <Text>x</Text>;
}`,
    `${header} export function Panel(): NativeView {
  const slot = resource(() => "nope");
  return <Text>x</Text>;
}`,
    `${header} export function Panel(): NativeView {
  resource(() => new NativeResource());
  return <Text>x</Text>;
}`,
    `${header} export function Panel(): NativeView {
  if (true) { effect(() => {}, []); }
  return <Text>x</Text>;
}`,
  ];
  for (const text of cases) {
    expect(compile(text, { fileName: "panel.lucent.tsx" }).module).toBeNull();
  }
});
