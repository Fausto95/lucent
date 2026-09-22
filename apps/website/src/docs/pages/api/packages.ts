import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api",
  title: "Packages",
  description: "Every `@lucent-lang/*` package, what it is for, and which side of the boundary it lives on.",
  blocks: [
    {
      kind: "p",
      text: "Install `@lucent-lang/core`, plus `@lucent-lang/cli` for the command line. Authoring declarations, runtime helpers, configuration, Metro and Expo integrations are subpaths of that one public package. Compiler and host packages are internal dependencies.",
    },
    { kind: "h2", text: "Used from Lucent source" },
    {
      kind: "table",
      head: ["Package", "Exports", "Reference"],
      rows: [
        ["`@lucent-lang/core/types`", "`int8…uint64`, `float32`, `float64`, `NativeCallback`, global `LucentError`", "[types](/docs/api/types/)"],
        ["`@lucent-lang/core/objects`", "`SharedObject`", "[objects](/docs/api/objects/)"],
        ["`@lucent-lang/core/events`", "`event<T>()`, `Event<T>`, `Subscription`", "[events](/docs/api/events/)"],
        ["`@lucent-lang/core/ui`", "`VStack`, `HStack`, `ZStack`, `ScrollView`, `Text`, `Spacer`, `Button`, `TextField`, `Toggle`, `Slider`, wrappers, `NativeView`, `NativeProps`", "[ui](/docs/api/ui/)"],
        ["`@lucent-lang/core`", "`encodeUTF8`, `decodeUTF8`, `copyBytes`", "[built-in library](/docs/api/std/)"],
        ["`@lucent-lang/core/math`, `core/text`", "math and text helpers", "[built-in library](/docs/api/std/)"],
        ["`@lucent-lang/core/cancellation`", "`CancellationSource`", "[built-in library](/docs/api/std/)"],
        ["`@lucent-lang/core/platform`", "`Platform.OS`", "[built-in library](/docs/api/std/)"],
      ],
    },
    { kind: "h2", text: "Used from the app" },
    {
      kind: "table",
      head: ["Package", "Exports", "Reference"],
      rows: [
        ["`@lucent-lang/core/runtime`", "`LucentError`, `lucentCall`, `normalizeError`, buffer helpers", "[runtime](/docs/api/runtime/)"],
        ["`@lucent-lang/core/config`", "`defineNativeConfig`", "[config](/docs/api/config/)"],
      ],
    },
    { kind: "h2", text: "Tooling" },
    {
      kind: "table",
      head: ["Package", "Purpose", "Reference"],
      rows: [
        ["`@lucent-lang/cli`", "`lucent build | check | init | doctor | explain | ir | clean | sdk`; runs via `npx @lucent-lang/cli`", "[CLI](/docs/api/cli/)"],
        ["`@lucent-lang/core/metro`", "`withLucent(config, { host })`", "[integrations](/docs/api/integrations/)"],
        ["`@lucent-lang/core/expo`", "config plugin for `expo prebuild`", "[integrations](/docs/api/integrations/)"],
        ["`@lucent-lang/sdk`", "manifest generation from Swift symbol graphs, `.swiftinterface` and `android.jar`", "[library manifest](/docs/api/library-manifest/)"],
        ["`@lucent-lang/compiler`, `host-core`, `host-expo`, `host-nitro`, `backend-swift`, `backend-kotlin`", "the compiler itself; programmatic use only", "[how it works](/docs/how-it-works/#architecture)"],
      ],
    },
    {
      kind: "note",
      tone: "warn",
      text: "Packages are not on npm yet. Install from the repository workspace; publishing a 0.1.0 is the next item on the [roadmap](https://github.com/Fausto95/lucent/blob/main/ROADMAP.md).",
    },
  ],
};
