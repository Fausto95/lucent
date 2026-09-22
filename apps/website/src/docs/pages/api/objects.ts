import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/objects",
  title: "@lucent-lang/objects",
  description: "The optional `SharedObject` base for native classes.",
  blocks: [
    {
      kind: "code",
      filename: "declaration",
      code: "/** Native reference object. Extend only inside .lucent.ts source. */\nexport declare abstract class SharedObject {\n  /** Releases the application's native handle. Every alias becomes unusable. */\n  dispose(): void;\n}",
    },
    {
      kind: "p",
      text: "Extending `SharedObject` gives the editor the `dispose()` method on instances. It has no runtime; the generated proxy implements `dispose()` for every native class whether or not the class extends the marker.",
    },
    {
      kind: "code",
      filename: "counter.lucent.ts",
      code: 'import { SharedObject } from "@lucent-lang/objects";\n\nexport class Counter extends SharedObject {\n  value: number = 0;\n  constructor(initial: number) {\n    super();\n    this.value = initial;\n  }\n  increment(delta: number): number {\n    this.value += delta;\n    return this.value;\n  }\n}',
    },
    {
      kind: "table",
      head: ["Member", "Behaviour"],
      rows: [
        ["`new Counter(…)`", "Constructs the native object and returns a JS wrapper holding a handle."],
        ["`counter.value`", "Getter and setter bridged to the native field. Private fields have none."],
        ["`counter.increment(…)`", "Runs natively on the same object. Synchronous."],
        ["`counter.dispose()`", "Idempotent. Invalidates every alias of the handle. `FinalizationRegistry` is a fallback where available."],
      ],
    },
    { kind: "p", text: "Rules for fields, methods and boundaries are in [native classes](/docs/language/native-classes/)." },
  ],
};
