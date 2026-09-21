import { expect, test } from "vite-plus/test";
import { defineNativeClass, nativeObjectHandle, nativeObjectFromHandle } from "../src/index.ts";
test("preserves identity and releases each native object exactly once", () => {
  const released: number[] = [];
  let next = 0;
  const Counter = defineNativeClass("test.Counter", {
    name: "Counter",
    create: () => ++next,
    release: (id) => released.push(id),
    methods: { value: (id) => id },
    getters: {},
    setters: {},
  });
  const a = new Counter();
  const handle = nativeObjectHandle(a, "test.Counter");
  expect(nativeObjectFromHandle(handle, "test.Counter")).toBe(a);
  expect(() => nativeObjectHandle(a, "Other")).toThrow();
  a.dispose();
  a.dispose();
  expect(released).toEqual([handle]);
  expect(() => nativeObjectHandle(a, "test.Counter")).toThrow();
});
