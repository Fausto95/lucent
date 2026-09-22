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

test("disposal rejects new calls while accepted async work retains its handle", async () => {
  const { withNativeObjects } = await import("../src/objects.ts");
  const released: number[] = [];
  const Text = defineNativeClass("test.AsyncText", {
    name: "AsyncText",
    create: () => 991,
    release: (id) => released.push(id),
    methods: {},
    getters: {},
    setters: {},
  });
  const value = new Text();
  let finish!: () => void;
  const pending = withNativeObjects(
    [value],
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  value.dispose();
  value.dispose();
  expect(() => nativeObjectHandle(value, "test.AsyncText")).toThrow();
  expect(released).toEqual([]);
  finish();
  await pending;
  expect(released).toEqual([991]);
});
test("async invocation errors release transit ownership", async () => {
  const { withNativeObjects } = await import("../src/objects.ts");
  const released: number[] = [];
  const Text = defineNativeClass("test.FailedText", {
    name: "FailedText",
    create: () => 992,
    release: (id) => released.push(id),
    methods: {},
    getters: {},
    setters: {},
  });
  const value = new Text();
  await expect(
    withNativeObjects([value], () => {
      value.dispose();
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  expect(released).toEqual([992]);
});

test("returning a retained object creates a new live wrapper after disposal", async () => {
  const { withNativeObjects } = await import("../src/objects.ts");
  const released: number[] = [];
  const type = "test.ReturnedText";
  const Text = defineNativeClass(type, {
    name: "ReturnedText",
    create: () => 993,
    release: (id) => released.push(id),
    methods: {},
    getters: {},
    setters: {},
  });
  const value = new Text();
  const returned = await withNativeObjects([value], async () => {
    value.dispose();
    await Promise.resolve();
    return nativeObjectFromHandle(993, type);
  });
  expect(returned).not.toBe(value);
  expect(nativeObjectHandle(returned, type)).toBe(993);
  expect(released).toEqual([]);
  returned.dispose();
  expect(released).toEqual([993]);
});
test("parallel calls retain the handle until every accepted call completes", async () => {
  const { withNativeObjects } = await import("../src/objects.ts");
  const released: number[] = [];
  const Text = defineNativeClass("test.ParallelText", {
    name: "ParallelText",
    create: () => 994,
    release: (id) => released.push(id),
    methods: {},
    getters: {},
    setters: {},
  });
  const value = new Text();
  let completeA!: () => void, completeB!: () => void;
  const a = withNativeObjects(
    [value],
    () =>
      new Promise<void>((r) => {
        completeA = r;
      }),
  );
  const b = withNativeObjects(
    [value],
    () =>
      new Promise<void>((r) => {
        completeB = r;
      }),
  );
  value.dispose();
  completeA();
  await a;
  expect(released).toEqual([]);
  completeB();
  await b;
  expect(released).toEqual([994]);
});

test.each([false, true])("replacement disposal waits for old work (reject=%s)", async (reject) => {
  const { withNativeObjects } = await import("../src/objects.ts");
  const released: number[] = [];
  const handle = reject ? 996 : 995;
  const type = `test.ReplacedText.${handle}`;
  const Text = defineNativeClass(type, {
    name: "ReplacedText",
    create: () => handle,
    release: (id) => released.push(id),
    methods: {},
    getters: {},
    setters: {},
  });
  const original = new Text();
  let complete!: () => void;
  const older = withNativeObjects(
    [original],
    () =>
      new Promise<void>((resolve, fail) => {
        complete = () => (reject ? fail(new Error("native failure")) : resolve());
      }),
  );
  const returned = await withNativeObjects([original], async () => {
    original.dispose();
    return nativeObjectFromHandle(handle, type);
  });
  let completeNew!: () => void;
  const newer = withNativeObjects(
    [returned],
    () =>
      new Promise<void>((resolve) => {
        completeNew = resolve;
      }),
  );
  returned.dispose();
  expect(released).toEqual([]);
  completeNew();
  await newer;
  expect(released).toEqual([]);
  const settled = reject ? expect(older).rejects.toThrow("native failure") : older;
  complete();
  await settled;
  expect(released).toEqual([handle]);
  original.dispose();
  returned.dispose();
  expect(released).toEqual([handle]);
});
