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

test('disposal rejects new calls while accepted async work retains its handle', async () => {
 const {withNativeObjects}=await import('../src/objects.ts');
 const released:number[]=[];
 const Text=defineNativeClass('test.AsyncText',{name:'AsyncText',create:()=>991,release:id=>released.push(id),methods:{},getters:{},setters:{}});
 const value=new Text();
 let finish!:()=>void;
 const pending=withNativeObjects([value],()=>new Promise<void>(resolve=>{finish=resolve;}));
 value.dispose();value.dispose();
 expect(()=>nativeObjectHandle(value,'test.AsyncText')).toThrow();
 expect(released).toEqual([]);
 finish();await pending;
 expect(released).toEqual([991]);
});
test('async invocation errors release transit ownership', async()=>{
 const {withNativeObjects}=await import('../src/objects.ts');
 const released:number[]=[];
 const Text=defineNativeClass('test.FailedText',{name:'FailedText',create:()=>992,release:id=>released.push(id),methods:{},getters:{},setters:{}});
 const value=new Text();
 await expect(withNativeObjects([value],()=>{value.dispose();throw new Error('failed');})).rejects.toThrow('failed');
 expect(released).toEqual([992]);
});
