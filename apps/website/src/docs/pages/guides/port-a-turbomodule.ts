import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["TurboModule or Nitro", "Lucent"],
    rows: [
      ["the spec: `NativeX.ts`, or a Nitro `.nitro.ts` interface", "the module's exports: its functions, types and classes"],
      ["codegen, or Nitrogen", "none: `lucent build` compiles the module"],
      ["Objective-C++, Swift, Kotlin or C++ implementations", "one `.lucent.ts` file, with a branch per platform"],
      ["a Nitro hybrid object", "an exported class: its instances cross by reference"],
      ["`Promise<T>` methods", "`async` exports; they run on the Lucent thread"],
      ["events through `RCTEventEmitter` or listeners", "a callback parameter and a stop function"],
      ["`ArrayBuffer`", "`Uint8Array`, copied"],
      ["the library's podspec and Gradle file", "`lucent.json`, if the module needs pods, dependencies or permissions"],
    ],
  },
  {
    kind: "code",
    filename: "counter.lucent.ts",
    code: `/** A Nitro hybrid object becomes a class: JavaScript holds one native instance. */
export class Counter {
  private value = 0;

  increment(by: number): number {
    this.value += by;
    return this.value;
  }

  async reset(): Promise<void> {
    this.value = 0;
  }
}`,
  },
  {
    kind: "code",
    filename: "App.tsx",
    code: `import { Counter } from "./src/counter.lucent";

const counter = new Counter();
counter.increment(2); // 2`,
  },
  {
    kind: "p",
    text: "Values that Nitro passes without copying, such as large arrays, are copied here. Keep them in native code across calls, as [Design the boundary first](/docs/thinking/boundary-first/) shows.",
  },
  {
    kind: "note",
    tone: "warn",
    text: "Lucent has no views yet: a Fabric component stays as it is ([roadmap](/docs/status/)).",
  },
];
