import type { DocPage } from "../types";

export const page: DocPage = {
  slug: "examples",
  title: "Examples",
  description:
    "Annotated modules, views and packages. Every example is taken from the Expo and bare example apps in the repository, which assert each result on a device.",
  blocks: [
    {
      kind: "p",
      text: "Run them yourself: [apps/expo-example](https://github.com/Fausto95/lucent/tree/main/apps/expo-example) and [apps/bare-example](https://github.com/Fausto95/lucent/tree/main/apps/bare-example) share the same sources and show ALL OK on iOS and Android when every check passes.",
    },

    { kind: "h2", text: "A pure function" },
    {
      kind: "p",
      text: "The smallest possible module. Parameters and the return type are annotated; the body is ordinary TypeScript. Both platforms get a readable function with the same shape.",
    },
    {
      kind: "tabs",
      tabs: [
        {
          label: "Source",
          filename: "src/math.lucent.ts",
          code: "export function clamp(value: number, min: number, max: number): number {\n  if (value < min) return min;\n  if (value > max) return max;\n  return value;\n}\n\nexport function fibonacci(n: number): number {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}",
        },
        {
          label: "Swift",
          filename: "generated",
          code: "func clamp(value: Double, min: Double, max: Double) throws -> Double {\n  if value < min {\n    return min\n  }\n  if value > max {\n    return max\n  }\n  return value\n}",
        },
        {
          label: "Kotlin",
          filename: "generated",
          code: "fun clamp(value: Double, min: Double, max: Double): Double {\n  if (value < min) {\n    return min\n  }\n  if (value > max) {\n    return max\n  }\n  return value\n}",
        },
        {
          label: "App",
          filename: "App.tsx",
          code: 'import { clamp, fibonacci } from "./src/math.lucent";\n\nclamp(15, 0, 10); // 10\nfibonacci(20); // 6765',
        },
      ],
    },

    { kind: "h2", text: "Records and optionals" },
    {
      kind: "p",
      text: "An object type alias is a value record: a Swift `struct` and a Kotlin `data class`. Optional fields must be narrowed with an explicit `=== undefined` or `=== null` check before use. `int32` from `@lucent-lang/types` picks a 32-bit integer instead of a double.",
    },
    {
      kind: "code",
      filename: "src/people.lucent.ts",
      code: 'import type { int32 } from "@lucent-lang/types";\n\nexport type Person = {\n  name: string;\n  age: int32;\n  nickname?: string;\n  tags: string[];\n};\n\nexport function birthday(person: Person): Person {\n  return { name: person.name, age: person.age + 1, nickname: person.nickname, tags: person.tags };\n}\n\nexport function describe(person: Person): string {\n  const nickname = person.nickname;\n  if (nickname === undefined) {\n    return `${person.name} (${person.age})`;\n  }\n  return `${nickname} aka ${person.name} (${person.age})`;\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'const ada: Person = { name: "Ada", age: 36, nickname: undefined, tags: ["math"] };\n\nbirthday(ada); // { name: "Ada", age: 37, nickname: null, tags: ["math"] }\ndescribe(ada); // "Ada (36)"\ndescribe({ ...ada, nickname: "Countess" }); // "Countess aka Ada (36)"',
    },
    {
      kind: "note",
      text: "Records are copied across the boundary, and hosts do not promise a key order. An absent optional comes back as `null`.",
    },

    { kind: "h2", text: "Bytes" },
    {
      kind: "p",
      text: "`Uint8Array` crosses as an `ArrayBuffer`. Indexing yields a `number`, like in JavaScript. A synchronous function reads the caller's buffer in place; an async one receives a copy.",
    },
    {
      kind: "code",
      filename: "src/people.lucent.ts",
      code: "export function checksum(data: Uint8Array): number {\n  let sum = 0;\n  for (let i = 0; i < data.length; i++) {\n    sum += data[i];\n  }\n  return sum % 256;\n}",
    },
    { kind: "code", filename: "App.tsx", code: "checksum(new Uint8Array([250, 10, 1])); // 5" },

    { kind: "h2", text: "Async and errors" },
    {
      kind: "p",
      text: "`async` functions must return `Promise<T>` and become Swift `async` / Kotlin `suspend`. `LucentError` is the only throwable. It reaches JavaScript with `code`, `message` and scalar `metadata` on both hosts.",
    },
    {
      kind: "code",
      filename: "src/math.lucent.ts",
      code: 'export async function total(values: number[]): Promise<number> {\n  let sum = 0;\n  for (const value of values) {\n    sum += value;\n  }\n  return sum;\n}\n\nexport function divide(a: number, b: number): number {\n  if (b === 0) {\n    throw new LucentError("DIVIDE_BY_ZERO", { message: "Cannot divide by zero" });\n  }\n  return a / b;\n}\n\nexport function missing(path: string): void {\n  throw new LucentError("MISSING", {\n    message: "File not found",\n    metadata: { path, attempt: 1, retry: false, detail: null },\n  });\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'await total([1, 2, 3.5]); // 6.5\n\ntry {\n  divide(1, 0);\n} catch (error) {\n  const e = error as LucentError;\n  e.code; // "DIVIDE_BY_ZERO"\n  e.message; // "Cannot divide by zero"\n}\n\ntry {\n  missing("/tmp/é");\n} catch (error) {\n  (error as LucentError).metadata; // { path: "/tmp/é", attempt: 1, retry: false, detail: null }\n}',
    },

    { kind: "h2", text: "Discriminated unions" },
    {
      kind: "p",
      text: "Variants share a required string-literal tag. The checker narrows after `===` / `!==` on a local or parameter, including the early-return form. Natively this is a tagged record with nullable payload slots; the proxy strips inactive slots so the app sees the plain TypeScript union.",
    },
    {
      kind: "code",
      filename: "src/features.lucent.ts",
      code: 'import { abs, sqrt } from "@lucent-lang/core/math";\n\nexport type Result = { kind: "ok"; value: number } | { kind: "error"; message: string };\n\nexport function evaluate(value: number): Result {\n  if (value < 0) {\n    return { kind: "error", message: "Negative" };\n  }\n  return { kind: "ok", value: sqrt(abs(value)) };\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'evaluate(9); // { kind: "ok", value: 3 }\nevaluate(-1); // { kind: "error", message: "Negative" }',
    },

    { kind: "h2", text: "A native class" },
    {
      kind: "p",
      text: "A class becomes a reference object in Swift and Kotlin. JavaScript holds an opaque handle: calling a method, reading a field, or passing the instance to another Lucent module all operate on the same native object. Fields are scalars with initializers; methods are synchronous.",
    },
    {
      kind: "code",
      filename: "src/counter.lucent.ts",
      code: 'import { SharedObject } from "@lucent-lang/objects";\n\nexport class Counter extends SharedObject {\n  value: number = 0;\n\n  constructor(initial: number) {\n    super();\n    this.value = initial;\n  }\n\n  increment(delta: number): number {\n    this.value += delta;\n    return this.value;\n  }\n}',
    },
    {
      kind: "code",
      filename: "src/features.lucent.ts",
      code: 'import type { Counter } from "./counter.lucent";\n\nexport function advance(counter: Counter): number {\n  return counter.increment(1);\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'const counter = new Counter(4);\ncounter.increment(2); // 6\nadvance(counter); // 7, same native object\ncounter.value; // 7\ncounter.dispose(); // release the native handle; every alias is now invalid',
    },

    { kind: "h2", text: "A typed event" },
    {
      kind: "p",
      text: "Declare an event at module scope, emit it from native code, subscribe from the app. Importing the event from another Lucent file refers to the same native channel.",
    },
    {
      kind: "code",
      filename: "src/features.lucent.ts",
      code: 'import { event } from "@lucent-lang/events";\n\nexport const progress = event<number>();\n\nexport function report(value: number): void {\n  progress.emit(value);\n}',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'const subscription = progress.subscribe((value) => {\n  console.log(value); // 42\n});\nreport(42);\n\n// when the consumer unmounts\nsubscription.remove();',
    },

    { kind: "h2", text: "Threads and the standard library" },
    {
      kind: "p",
      text: "A decorator picks where a function runs. A thread hop requires an `async` function. Standard library calls are direct Swift and Kotlin calls; the ones that touch the platform need a capability in `lucent.config.ts`.",
    },
    {
      kind: "code",
      filename: "src/features.lucent.ts",
      code: 'import { encodeUTF8, decodeUTF8 } from "@lucent-lang/core";\nimport { sha256 } from "@lucent-lang/crypto";\nimport { read, write, temporaryDirectory } from "@lucent-lang/filesystem";\nimport { now } from "@lucent-lang/platform/clock";\n\n// @ts-expect-error Lucent function decorator; compiled before TypeScript.\n@Background\nexport async function double(value: number): Promise<number> {\n  return value * 2;\n}\n\nexport function hash(text: string): string {\n  return sha256(encodeUTF8(text));\n}\n\nexport async function fileRoundTrip(text: string): Promise<string> {\n  const directory = await temporaryDirectory();\n  const path = directory + "/lucent-check.txt";\n  await write(path, encodeUTF8(text));\n  return decodeUTF8(await read(path));\n}\n\nexport function timestamp(): number {\n  return now();\n}',
    },
    {
      kind: "code",
      filename: "lucent.config.ts",
      code: 'import { defineNativeConfig } from "@lucent-lang/config";\n\nexport default defineNativeConfig({\n  capabilities: { clock: true, crypto: true, filesystem: true },\n});',
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'await double(4); // 8, computed on a worker\nhash("abc"); // "ba7816bf…f20015ad"\nawait fileRoundTrip("Lucent 🌍"); // "Lucent 🌍"\nMath.abs(timestamp() - Date.now()) < 5000; // true',
    },
    {
      kind: "note",
      text: "The `@ts-expect-error` line keeps the editor's TypeScript quiet. Lucent parses the decorator before Metro hands the generated proxy to TypeScript tooling.",
    },

    { kind: "h2", text: "Platform guards" },
    {
      kind: "p",
      text: "`Platform.OS` is a compile-time constant per target. A binding declared for one platform can only be called inside a guard; otherwise `NT2004` reports it. The other target compiles with a throwing stub.",
    },
    {
      kind: "code",
      filename: "src/home.lucent.ts",
      code: 'import { Platform } from "@lucent-lang/platform";\nimport { homeDirectory } from "@lucent-lang/sdk/foundation";\n\nexport function nativeOS(): string {\n  return Platform.OS; // "ios" | "android"\n}\n\nexport function home(): string {\n  if (Platform.OS === "ios") {\n    return homeDirectory();\n  }\n  return "";\n}',
    },

    { kind: "h2", text: "A native view with controls" },
    {
      kind: "p",
      text: "One `.lucent.tsx` component becomes SwiftUI on iOS and Compose on Android. `FieldScreen` owns its label, gain, and arming flag with `state()`. The sample list and the record event stay in the app, which drives a `FieldKit` class. `Badge` is another Lucent component imported from a sibling file.",
    },
    {
      kind: "code",
      filename: "src/badge.lucent.tsx",
      code: 'import { Text, type NativeProps, type NativeView } from "@lucent-lang/ui";\n\ntype Props = { title: string };\n\nexport function Badge(props: NativeProps<Props>): NativeView {\n  return (\n    <Text size={26} color="#e7f6ef">\n      {props.title}\n    </Text>\n  );\n}',
    },
    {
      kind: "tabs",
      tabs: [
        {
          label: "Source",
          filename: "src/field-screen.lucent.tsx",
          code: 'import { ScrollView, VStack, Text, TextField, Button, For, type NativeProps, type NativeView } from "@lucent-lang/ui";\nimport type { Event } from "@lucent-lang/events";\n\ntype Props = { title: string; notes: string[]; onRecord: Event<void> };\n\nexport function FieldScreen(props: NativeProps<Props>): NativeView {\n  const draft = state("Ridge line");\n  return (\n    <ScrollView>\n      <VStack padding={18} spacing={12}>\n        <Text size={22}>{props.title}</Text>\n        <For each={props.notes}>{(note: string) => <Text>{note}</Text>}</For>\n        <TextField value={draft} onChange={(value: string) => draft.set(value)} placeholder="Label" />\n        <Button title="Record sample" onPress={props.onRecord} />\n      </VStack>\n    </ScrollView>\n  );\n}',
        },
        {
          label: "Swift",
          filename: "generated (Badge)",
          code: 'import SwiftUI\nenum LucentBadgeViews {\n  struct Props {\n    var title: String\n  }\n\n  @MainActor static func Badge(props: Props) -> AnyView {\n    return AnyView(Text(props.title).font(.system(size: CGFloat(26.0))).foregroundColor(lucentViewColor("#e7f6ef")))\n  }\n}',
        },
        {
          label: "Kotlin",
          filename: "generated (Badge)",
          code: 'object LucentBadgeViews {\n  data class Props(var title: String)\n\n  @Composable fun Badge(props: Props): Unit {\n    return Text(text = props.title, fontSize = (26.0).toFloat().sp, color = Color(android.graphics.Color.parseColor("#e7f6ef")))\n  }\n}',
        },
      ],
    },
    {
      kind: "code",
      filename: "App.tsx",
      code: 'import { useState } from "react";\nimport { FieldScreen } from "./src/field-screen.lucent";\nimport { FieldKit } from "./src/field-kit.lucent";\n\nconst kit = new FieldKit("North ridge");\n\nexport function Screen() {\n  const [notes, setNotes] = useState(["Baseline"]);\n  return (\n    <FieldScreen\n      style={{ height: 520 }}\n      title={kit.name}\n      notes={notes}\n      onRecord={() => setNotes((items) => [...items, `Sample ${kit.record()}`])}\n    />\n  );\n}',
    },

    { kind: "h2", text: "A native package view" },
    {
      kind: "p",
      text: "When the shared controls are not enough, a library can ship its own SwiftUI and Compose adapters and expose them as a view. The compiler validates the descriptor; the host writes the adapter sources and wires CocoaPods and Gradle. State inside the adapter stays native, and changes reach React as an event.",
    },
    {
      kind: "code",
      filename: "native/counter.library.json",
      code: '{\n  "source": "",\n  "native": {\n    "swift": {\n      "Counter.swift": "import SwiftUI\\nstruct LucentPackageCounter: View {\\n  var onChange: (Double) -> Void\\n  @State private var count: Double = 0\\n  var body: some View {\\n    HStack {\\n      Button(\\"−\\") { count -= 1; onChange(count) }\\n      Text(\\"Native state: \\\\(Int(count))\\")\\n      Button(\\"+\\") { count += 1; onChange(count) }\\n    }\\n  }\\n}\\n"\n    },\n    "kotlin": {\n      "Counter.kt": "package {{androidPackage}}\\nimport androidx.compose.runtime.*\\nimport androidx.compose.foundation.layout.Row\\nimport androidx.compose.material3.Button\\nimport androidx.compose.material3.Text\\n@Composable\\nfun LucentPackageCounter(onChange: (Double) -> Unit) {\\n  var count by remember { mutableDoubleStateOf(0.0) }\\n  Row {\\n    Button(onClick = { count -= 1; onChange(count) }) { Text(\\"−\\") }\\n    Text(\\"Native state: ${count.toInt()}\\")\\n    Button(onClick = { count += 1; onChange(count) }) { Text(\\"+\\") }\\n  }\\n}\\n"\n    }\n  },\n  "views": {\n    "Counter": {\n      "props": { "onChange": { "kind": "event", "payload": { "kind": "float", "bits": 64 } } },\n      "required": ["onChange"],\n      "children": "none",\n      "swift": { "template": "LucentPackageCounter(onChange: {{prop:onChange}})" },\n      "kotlin": { "template": "LucentPackageCounter(onChange = {{prop:onChange}})" }\n    }\n  }\n}',
    },
    {
      kind: "code",
      filename: "lucent.config.ts",
      code: 'import { defineNativeConfig } from "@lucent-lang/config";\n\nexport default defineNativeConfig({\n  libraries: { "@lucent-lang/example-counter": "./native/counter.library.json" },\n});',
    },
    {
      kind: "code",
      filename: "src/native-libraries.d.ts",
      code: 'declare module "@lucent-lang/example-counter" {\n  import type { NativeView } from "@lucent-lang/ui";\n  export function Counter(props: { onChange: (value: number) => void }): NativeView;\n}',
    },
    {
      kind: "code",
      filename: "src/native-card.lucent.tsx",
      code: 'import { Counter } from "@lucent-lang/example-counter";\n\n// inside NativeCard:\n<Counter onChange={props.onCount} />',
    },
    {
      kind: "p",
      text: "The `.d.ts` file only exists for the editor. The compiler reads the manifest through `lucent.config.ts`; nothing from the package runs in JavaScript. See the [library manifest reference](/docs/api/library-manifest/).",
    },

    { kind: "h2", text: "Modules importing modules" },
    {
      kind: "p",
      text: "Named imports between Lucent files resolve at build time, transitively. Only exports can be imported; cycles and missing files are `NT1006`. Source basenames must be unique within one build.",
    },
    {
      kind: "code",
      filename: "src/math.lucent.ts",
      code: "export function square(value: number): number {\n  return value * value;\n}",
    },
    {
      kind: "code",
      filename: "src/distance.lucent.ts",
      code: 'import { square } from "./math.lucent";\n\nexport function squaredDistance(x: number, y: number): number {\n  return square(x) + square(y);\n}',
    },
  ],
};
