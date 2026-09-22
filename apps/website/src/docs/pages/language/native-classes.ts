import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/native-classes",
  title: "Native classes",
  description: "A class is a reference object that lives in native memory. JavaScript holds a handle; methods and fields operate on the same native instance.",
  blocks: [
    {
      kind: "code",
      filename: "counter.lucent.ts",
      code: 'import { SharedObject } from "@lucent-lang/core/objects";\n\nexport class Counter extends SharedObject {\n  value: number = 0;\n  private ticks: number = 0;\n\n  constructor(initial: number) {\n    super();\n    this.value = initial;\n  }\n\n  increment(delta: number): number {\n    this.ticks += 1;\n    this.value += delta;\n    return this.value;\n  }\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { Counter } from "./src/counter.lucent";\n\nconst counter = new Counter(4);\ncounter.increment(2); // 6\ncounter.value; // 6\ncounter.dispose(); // release the native handle',
    },
    { kind: "h2", text: "What is generated" },
    {
      kind: "p",
      text: "Swift gets a `final class`, Kotlin a `class`. Each public field gets a getter and setter; each method a bridged function. The JS wrapper stores an opaque handle from an identity registry, so passing the instance to another Lucent module (`advance(counter)`) reaches the same object with no state copied through JavaScript. Synchronous calls that cross a shared-object boundary are serialized by a recursive native lock.",
    },
    { kind: "h2", text: "Rules" },
    {
      kind: "list",
      items: [
        "Fields must have a declared scalar type (`number`, `string`, `boolean`, or a nullable form) and an initializer.",
        "`private` fields stay native. They have no JS accessors and cannot be read outside their class.",
        "Methods are synchronous with explicit types. They may accept and return `Uint8Array`.",
        "Instances cross function boundaries directly, never inside arrays, records or optionals.",
        "Async functions cannot accept an instance as an argument.",
        "Extending `SharedObject` is optional; it only supplies `dispose()` to the editor. Plain classes compile too.",
        "Rejected: inheritance beyond the marker, `static`, private methods, getters and setters, decorators on classes, async methods, nested classes.",
      ],
    },
    { kind: "h2", text: "Lifetime" },
    {
      kind: "p",
      text: "Call `dispose()` when the app no longer needs the object. Disposal is idempotent and invalidates every JavaScript alias of the handle. Where the engine implements `FinalizationRegistry`, garbage collection also releases the handle, but explicit disposal is the only deterministic path. Disposing does not run a custom native destructor.",
    },
    {
      kind: "p",
      text: "Classes bound from a real SDK (`references` in a [library manifest](/docs/api/library-manifest/)) use the same handle registry when they cross into JavaScript, and plain native ownership when they stay inside native code.",
    },
  ],
};
