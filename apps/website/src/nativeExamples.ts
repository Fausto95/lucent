export const nativeCard = `import { Column, Text, Button, type NativeProps,
  type NativeView } from "@lucent-lang/ui";
import type { Event } from "@lucent-lang/events";

type Props = { title: string; onPress: Event<void> };

export function Card(props: NativeProps<Props>): NativeView {
  return (
    <Column padding={16} spacing={12}>
      <Text size={20}>{props.title}</Text>
      <Button title="Continue" onPress={props.onPress} />
    </Column>
  );
}`;

export const nativeSections = [
  {
    id: "imports",
    title: "Imports & composition",
    label: "03 / CONNECT YOUR SOURCE",
    description:
      "Split native logic and components into reusable files. Named, aliased, and type-only imports resolve across .lucent.ts and .lucent.tsx files, including their transitive dependencies.",
    examples: [
      {
        filename: "math.lucent.ts",
        code: `export function square(value: number): number {\n  return value * value;\n}`,
      },
      {
        filename: "distance.lucent.ts",
        code: `import { square } from "./math.lucent";\n\nexport function squaredDistance(x: number, y: number): number {\n  return square(x) + square(y);\n}`,
      },
    ],
    detail:
      "Use extensionless .lucent imports or explicit .lucent.ts / .lucent.tsx extensions. Only exported declarations may be imported. Cycles, ambiguous paths, and missing exports produce diagnostics; source basenames must be unique within a build.",
    limit:
      "Imports resolve Lucent source and registered native libraries. Arbitrary npm JavaScript and default or namespace imports are outside the subset.",
  },
  {
    id: "unions",
    title: "Discriminated unions",
    label: "04 / MAKE EVERY CASE EXPLICIT",
    description:
      "Model outcomes with a shared string-literal tag. The compiler checks each variant and narrows its payload after a tag comparison, including an early return.",
    examples: [
      {
        filename: "result.lucent.ts",
        code: `export type Result =\n  | { kind: "ok"; value: number }\n  | { kind: "error"; message: string };\n\nexport function read(result: Result): number {\n  if (result.kind === "ok") {\n    return result.value;\n  }\n  return 0;\n}`,
      },
    ],
    detail:
      "Variants can be inline records or named record aliases. Generated proxies retain the TypeScript union while native code uses a tagged record with nullable payload slots.",
    limit:
      "Tags must be unique and required. Fields shared by variants need the same type. Use === or !== on a local or parameter to narrow; switch is not supported. Replace the whole value to change variants.",
  },
  {
    id: "shared-objects",
    title: "Native classes & shared objects",
    label: "05 / IDENTITY THAT STAYS NATIVE",
    description:
      "Keep an instance alive in native memory and call it from React Native. JavaScript holds an opaque handle; methods and property access operate on the same native object across modules.",
    examples: [
      {
        filename: "counter.lucent.ts",
        code: `import { SharedObject } from "@lucent-lang/objects";\n\nexport class Counter extends SharedObject {\n  value: number = 0;\n\n  constructor(initial: number) {\n    super();\n    this.value = initial;\n  }\n\n  increment(delta: number): number {\n    this.value += delta;\n    return this.value;\n  }\n}`,
      },
      {
        filename: "App.tsx · native API usage",
        code: `import { Counter } from "./counter.lucent";\n\nconst counter = new Counter(4);\ncounter.increment(2); // 6\nconsole.log(counter.value); // 6\ncounter.dispose(); // release the native handle`,
      },
    ],
    detail:
      "Construction, public scalar fields, synchronous methods, and this are supported. The SharedObject marker is optional. Explicit dispose() releases the handle; finalization is a fallback where the JavaScript engine supports it.",
    limit:
      "Fields are scalar or nullable scalar values. Pass objects directly across function boundaries, not inside containers. Shared-object arguments require synchronous functions. Custom inheritance, private/static members, and async methods are not supported.",
  },
  {
    id: "events",
    title: "Events",
    label: "06 / NATIVE CODE, APP UPDATES",
    description:
      "Declare a typed event at module scope, emit from native code, and subscribe from the app. Importing an event from another Lucent file keeps the same native channel.",
    examples: [
      {
        filename: "progress.lucent.ts",
        code: `import { event } from "@lucent-lang/events";\n\nexport const progress = event<number>();\n\nexport function report(value: number): void {\n  progress.emit(value);\n}`,
      },
      {
        filename: "App.tsx · subscription",
        code: `import { progress, report } from "./progress.lucent";\n\nconst subscription = progress.subscribe((value) => {\n  console.log(value);\n});\nreport(42);\n\n// Remove the subscription when the consumer unmounts.\nsubscription.remove();`,
      },
    ],
    detail:
      "Payloads can be JSON-compatible scalars, records, arrays, maps, or nullable values. Use event<void>() for an event without a payload. Subscriptions are app-only; native code emits.",
    limit:
      "Events are not replayed. Delivery follows the host’s scheduling rules. Bytes, shared objects, callbacks, views, and non-finite numbers are not supported event payloads.",
  },
  {
    id: "native-views",
    title: "Declarative native views",
    label: "07 / ONE COMPONENT, TWO PLATFORMS",
    description:
      "Write the shared component model in .lucent.tsx. Lucent generates SwiftUI for iOS and Jetpack Compose for Android, exposed through Expo views or Nitro Fabric views.",
    examples: [
      { filename: "card.lucent.tsx", code: nativeCard },
      {
        filename: "App.tsx",
        code: `import { useState } from "react";\nimport { Card } from "./card.lucent";\n\nexport function Screen() {\n  const [count, setCount] = useState(0);\n  return (\n    <Card\n      style={{ height: 140 }}\n      title={\`Native taps: \${count}\`}\n      onPress={() => setCount((value) => value + 1)}\n    />\n  );\n}`,
      },
    ],
    detail:
      "Compose Column, Row, Text, Spacer, and Button, or import another .lucent.tsx component. NativeProps<P> adds React Native layout props for app usage; only P is available in the native render function. Props accept string, number, boolean, nullable values, and required Event<void> callbacks.",
    limit:
      "Rendering is synchronous and pure. Keep state and effects in your React app, then pass new props. Hooks, arbitrary React components, loops, dynamic lists, JSX spreads/fragments, and custom children are not supported. Nitro views require the new architecture.",
  },
  {
    id: "threads",
    title: "Thread annotations",
    label: "08 / CHOOSE WHERE WORK RUNS",
    description:
      "Use a declaration annotation to select the calling context, main thread, or worker pool. A thread hop is asynchronous and returns a promise to JavaScript.",
    examples: [
      {
        filename: "work.lucent.ts",
        code: `@Background\nexport async function double(value: number): Promise<number> {\n  return value * 2;\n}`,
      },
    ],
    detail:
      "@Inherited is the default. @MainThread uses Swift’s main actor and Kotlin Dispatchers.Main. @Background uses a Swift detached task and Kotlin Dispatchers.Default.",
    limit:
      "Main and worker annotations require an async function. Thread selection does not make shared mutable state safe; shared-object parameters remain restricted to synchronous functions.",
  },
  {
    id: "native-libraries",
    title: "Native libraries & capabilities",
    label: "09 / REACH THE PLATFORM",
    description:
      "Import native math and text operations, use the clock and locale bindings, or register a typed SDK binding with Swift and Kotlin implementations.",
    examples: [
      {
        filename: "metrics.lucent.ts",
        code: `import { abs, sqrt } from "@lucent-lang/std/math";\nimport { now } from "@lucent-lang/platform/clock";\n\nexport function magnitude(value: number): number {\n  return sqrt(abs(value));\n}\n\nexport function timestamp(): number {\n  return now(); // Unix milliseconds\n}`,
      },
      { filename: "lucent.config.json", code: `{\n  "capabilities": ["clock", "locale"]\n}` },
      {
        filename: "lucent.config.json · custom SDK binding",
        code: JSON.stringify(
          {
            capabilities: ["device"],
            libraries: {
              "@lucent-lang/platform/device": {
                source: "export declare function model(): Promise<string>;",
                bindings: {
                  model: {
                    swiftImports: ["UIKit"],
                    swift: ["return UIDevice.current.model"],
                    kotlin: ["return android.os.Build.MODEL"],
                    capabilities: ["device"],
                    thread: "main",
                  },
                },
              },
            },
          },
          null,
          2,
        ),
      },
    ],
    detail:
      "std/math provides abs, sqrt, floor, ceil, sin, cos, min, and max. std/text provides trim and contains. platform/clock exposes now(); platform/locale exposes languageTag(). Build, check, and Metro enforce the required capabilities and native generation emits a lucent-manifest.json.",
    limit:
      "Custom bindings need both native implementations and matching editor declarations. Capability configuration is a build-time allowlist. Configure OS permissions, entitlements, and runtime permission requests in your app.",
  },
];
