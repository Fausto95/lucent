import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/library-manifest",
  title: "Library manifest",
  description:
    "A `library.json` file describes a native library: its TypeScript surface, Swift and Kotlin bodies, SDK references, custom views, and shipped adapter sources.",
  blocks: [
    {
      kind: "p",
      text: "Register a manifest in `lucent.config.ts` under an `@lucent-lang/` specifier, then import it from Lucent source. The compiler validates the metadata; the host writes the native code. Bodies and templates are trusted native build inputs.",
    },
    {
      kind: "code",
      filename: "shape",
      code: '{\n  "source": "export declare function model(): Promise<string>;",\n  "bindings": { "model": { … } },\n  "references": { "Session": { … } },\n  "views": { "Widget": { … } },\n  "native": { "swift": { … }, "kotlin": { … }, "dependencies": { … }, "capabilities": [] }\n}',
    },
    { kind: "h2", text: "source" },
    {
      kind: "p",
      text: "TypeScript declarations for what the library exports, as one string. This is what the compiler type-checks calls against. Ship the same text as a `.d.ts` (or a `declare module` block) so the editor agrees. Async declarations return `Promise<T>`.",
    },
    { kind: "h2", text: "bindings" },
    {
      kind: "p",
      text: "One entry per exported function, keyed by name. Body lines are inserted into a generated function with the declared parameters in scope.",
    },
    {
      kind: "code",
      filename: "declaration",
      code: 'interface NativeBinding {\n  swift: string[];            // body lines\n  kotlin: string[];           // body lines\n  swiftImports?: string[];\n  kotlinImports?: string[];\n  capabilities?: string[];    // required in lucent.config.ts\n  platforms?: ("ios" | "android")[];  // one platform → needs a Platform.OS guard\n  thread?: "caller" | "main" | "worker";\n  cost?: "cpu" | "io";        // feeds LUCENT3002 main-thread warnings\n  nativeOnly?: boolean;       // callable from Lucent, absent from the JS API\n  platformQuery?: boolean;    // internal: Platform.OS\n}',
    },
    {
      kind: "code",
      filename: "device.library.json",
      code: '{\n  "source": "export declare function model(): Promise<string>;",\n  "bindings": {\n    "model": {\n      "swiftImports": ["UIKit"],\n      "swift": ["return UIDevice.current.model"],\n      "kotlin": ["return android.os.Build.MODEL"],\n      "capabilities": ["device"],\n      "thread": "main"\n    }\n  }\n}',
    },
    {
      kind: "list",
      items: [
        "`thread: \"main\"` or `\"worker\"` implies an async declaration; the generated function hops and returns a promise.",
        "With `platforms: [\"ios\"]`, the Android side becomes a throwing stub and Kotlin imports are dropped, so both targets compile. Calls must be guarded (`LUCENT2004`).",
        "`nativeOnly` bindings may take `NativeCallback` parameters; they are how native listeners are attached without exposing callbacks to JavaScript.",
      ],
    },
    { kind: "h2", text: "enums" },
    {
      kind: "p",
      text: "Declare an SDK enum or option set. `cases` lists the Lucent case names, and each target names its native type plus one native expression per case. The `source` must declare the same cases, in the same order, as a string-literal union; a mismatch is `LUCENT1006`.",
    },
    {
      kind: "code",
      filename: "camera.library.json",
      code: '{\n  "source": "export type Position = \\"front\\" | \\"back\\";\\nexport declare function setPosition(position: Position): void;",\n  "enums": {\n    "Position": {\n      "cases": ["front", "back"],\n      "swift": {\n        "type": "AVCaptureDevice.Position",\n        "values": { "front": ".front", "back": ".back" },\n        "imports": ["AVFoundation"]\n      },\n      "kotlin": { "type": "Int", "values": { "front": "0", "back": "1" } }\n    }\n  },\n  "bindings": {\n    "setPosition": { "swift": ["session.position = position"], "kotlin": ["session.facing = position"] }\n  }\n}',
    },
    {
      kind: "list",
      items: [
        "In Lucent source a case is a plain string literal that adopts the enum type from its context. A literal outside the list is `LUCENT1011` and the message names the valid cases.",
        "Native code only ever sees the SDK value. JavaScript only ever sees the case name, typed as the literal union in the generated declarations.",
        "The compiler emits a `LucentEnum_<Name>` bridge per target. A name JavaScript sends that is not a case throws `INVALID_ENUM_CASE` rather than being guessed.",
        "Enums are parameter, return and local types. They cannot be record fields or event payloads, or sit inside arrays, maps and optionals; carry the case as a plain string there.",
      ],
    },
    { kind: "h2", text: "references" },
    {
      kind: "p",
      text: "Map a record name in `source` to a real Swift and/or Kotlin class. Lucent emits a type alias and keeps the actual SDK instance. Operations are ordinary bindings with a naming convention:",
    },
    {
      kind: "table",
      head: ["Binding name", "Lucent syntax", "Notes"],
      rows: [
        ["`Name__create`", "`new Name(...)`", "must be synchronous"],
        ["`Name__get_prop`", "`object.prop`", "instance operations take `lucentSelf: Name` first"],
        ["`Name__set_prop`", "`object.prop = value`", "simple assignment only; omit for read-only"],
        ["`Name__method_run`", "`object.run(...)`", "use an overload group for supported argument-based dispatch"],
      ],
    },
    {
      kind: "code",
      filename: "session.library.json",
      code: '{\n  "source": "export type Session = { title: string };\\nexport declare function Session__create(title: string): Session;\\nexport declare function Session__get_title(lucentSelf: Session): string;\\nexport declare function Session__method_start(lucentSelf: Session): void;",\n  "references": {\n    "Session": { "swift": "SDKSession", "kotlin": "com.vendor.sdk.Session", "swiftImports": ["VendorSDK"] }\n  },\n  "bindings": {\n    "Session__create": { "swift": ["return SDKSession(title: title)"], "kotlin": ["return com.vendor.sdk.Session(title)"] },\n    "Session__get_title": { "swift": ["return lucentSelf.title"], "kotlin": ["return lucentSelf.title"] },\n    "Session__method_start": { "swift": ["lucentSelf.start()"], "kotlin": ["lucentSelf.start()"] }\n  }\n}',
    },
    {
      kind: "p",
      text: "References that stay inside native code use native ownership. When one crosses into JavaScript it gets a handle like a [native class](/docs/language/native-classes/), and `dispose()` invalidates it.",
    },
    { kind: "h2", text: "views" },
    {
      kind: "p",
      text: "Custom native views for `.lucent.tsx`. Each descriptor declares typed props, which are required, what children it accepts, and a Swift and a Kotlin template.",
    },
    {
      kind: "code",
      filename: "declaration",
      code: 'interface NativeViewBinding {\n  props: Record<string, PropType>;  // { kind: "string" | "bool" } | { kind: "float", bits: 64 }\n                                    // | { kind: "optional", value } | { kind: "event", payload }\n  required?: string[];\n  children: "views" | "text" | "none";\n  swift: { template: string; imports?: string[]; defaults?: Record<string, string> };\n  kotlin: { template: string; imports?: string[]; defaults?: Record<string, string> };\n}',
    },
    {
      kind: "code",
      filename: "counter.library.json (views)",
      code: '"views": {\n  "Counter": {\n    "props": { "onChange": { "kind": "event", "payload": { "kind": "float", "bits": 64 } } },\n    "required": ["onChange"],\n    "children": "none",\n    "swift": { "template": "LucentPackageCounter(onChange: {{prop:onChange}})" },\n    "kotlin": { "template": "LucentPackageCounter(onChange = {{prop:onChange}})" }\n  }\n}',
    },
    {
      kind: "list",
      items: [
        "Templates substitute `{{prop:name}}` and `{{children}}`.",
        "An optional prop referenced by a template needs a native expression in `defaults`.",
        "Event payloads are `void`, `string`, `bool` or 64-bit `float`.",
        "Metadata and required props are checked before generation; the template itself is trusted.",
      ],
    },
    { kind: "h2", text: "native" },
    {
      kind: "p",
      text: "Adapter sources and dependencies the library ships. The host writes each file once under `ios/LucentPackages/` and `android/src/main/java/LucentPackages/`, appends the pods and Gradle dependencies, and replaces `{{androidPackage}}` in Kotlin sources.",
    },
    {
      kind: "code",
      filename: "declaration",
      code: 'interface NativePackage {\n  swift?: Record<string, string>;       // "Widget.swift": source\n  kotlin?: Record<string, string>;      // "Widget.kt": source, may use {{androidPackage}}\n  dependencies?: {\n    pods?: Record<string, string>;      // "WidgetSDK": "~> 1.0"\n    android?: string[];                 // "dev.widgets:ui:1.0.0"\n  };\n  capabilities?: string[];              // required by the package as a whole\n}',
    },
    {
      kind: "list",
      items: [
        "Source keys must be simple `Name.swift` / `Name.kt` filenames.",
        "Two packages providing conflicting file contents or pod versions fail generation.",
        "Adapters own their view lifecycle and may keep SwiftUI `@State` or Compose `remember` state; report changes through event props.",
      ],
    },
    { kind: "h2", text: "Generating manifests" },
    {
      kind: "p",
      text: "`lucent sdk swift` and `lucent sdk android` produce `library.json` plus `index.d.ts` and a `schema.json` for scalar free functions and static methods. The same schema format accepts curated `classes` entries (constructors, properties, methods) that generate `references` bindings. See the [CLI](/docs/api/cli/#lucent-sdk).",
    },
    {
      kind: "note",
      tone: "warn",
      text: "Overload groups support free functions, constructors and methods; exact matches win over lossless numeric widening. Native availability is checked against configured minimum targets. Protocol and delegate implementations, Objective-C and Kotlin metadata import, contextual callback overloads, and runtime availability checks remain incomplete.",
    },
  ],
};
