import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/events",
  title: "@lucent-lang/core/events",
  description: "`event<T>()` declares a native event channel. `Event<T>` is the type of an app-side listener or a view callback prop.",
  blocks: [
    {
      kind: "code",
      filename: "declaration",
      code: "/** An app callback carried by a native view prop. */\nexport type Event<T> = (...args: T extends void ? [] : [payload: T]) => void;\n\nexport interface Subscription {\n  remove(): void;\n}\n\nexport interface NativeEvent<T> {\n  /** Available inside Lucent source only. */\n  emit(...args: T extends void ? [] : [payload: T]): void;\n  /** Available from the generated application proxy. */\n  subscribe(listener: Event<T>): Subscription;\n}\n\n/** Declare at module scope in a .lucent.ts file. No JS implementation is executed. */\nexport declare function event<T>(): NativeEvent<T>;",
    },
    { kind: "h2", text: "event<T>()" },
    {
      kind: "p",
      text: "Call it once at module scope and export the result. Native code calls `emit`; the app calls `subscribe`. The two sides never see each other's method.",
    },
    {
      kind: "code",
      filename: "progress.lucent.ts",
      code: 'import { event } from "@lucent-lang/core/events";\n\nexport const progress = event<number>();\nexport const done = event<void>();\n\nexport function report(value: number): void {\n  progress.emit(value);\n  done.emit();\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'const sub = progress.subscribe((value) => console.log(value));\nsub.remove();',
    },
    { kind: "h2", text: "Event<T>" },
    {
      kind: "p",
      text: "The listener shape, also used for callback props of [native views](/docs/language/native-views/). Payloads for view props are `void`, `string`, `boolean` or `number`. Payloads for module events are any JSON-compatible value.",
    },
    {
      kind: "code",
      filename: "card.lucent.tsx",
      code: 'import type { Event } from "@lucent-lang/core/events";\n\ntype Props = { onPress: Event<void>; onText: Event<string> };',
    },
    { kind: "p", text: "Semantics (no replay, locking, payload limits) are in [events](/docs/language/events/)." },
  ],
};
