import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "language/platform-and-capabilities",
  title: "Platform & capabilities",
  description:
    "Reach the platform through the standard library, guard platform-specific calls, declare capabilities once per app, and bind real SDK classes.",
  blocks: [
    { kind: "h2", text: "Standard library" },
    {
      kind: "p",
      text: "Each import is a direct Swift and Kotlin call, not a bridge. Some need a capability in `lucent.config.ts`; the build fails with `NT2001` if it is missing.",
    },
    {
      kind: "table",
      head: ["Import", "API", "Capability"],
      rows: [
        ["`@lucent-lang/core`", "`encodeUTF8`, `decodeUTF8`, `copyBytes`", "none"],
        ["`@lucent-lang/core/math`", "`abs`, `sqrt`, `floor`, `ceil`, `sin`, `cos`, `min`, `max`", "none"],
        ["`@lucent-lang/core/text`", "`trim`, `contains`", "none"],
        ["`@lucent-lang/crypto`", "`sha256(bytes)` → lowercase hex", "`crypto`"],
        ["`@lucent-lang/filesystem`", "async `read`, `write`, `exists`, `temporaryDirectory`", "`filesystem`"],
        ["`@lucent-lang/network`", "async `get(url)` → bytes", "`network`"],
        ["`@lucent-lang/device`", "async `model()`", "`device`"],
        ["`@lucent-lang/platform/clock`", "`now()` Unix milliseconds", "`clock`"],
        ["`@lucent-lang/platform/locale`", "`languageTag()`", "`locale`"],
        ["`@lucent-lang/platform`", "`Platform.OS`", "none"],
      ],
    },
    {
      kind: "code",
      filename: "hash.lucent.ts",
      code: 'import { read } from "@lucent-lang/filesystem";\nimport { sha256 } from "@lucent-lang/crypto";\n\n// @ts-expect-error Lucent function decorator; compiled before TypeScript.\n@Background\nexport async function hashFile(path: string): Promise<string> {\n  return sha256(await read(path));\n}',
    },
    {
      kind: "p",
      text: "Full signatures and error codes are in the [standard library reference](/docs/api/std/).",
    },
    { kind: "h2", text: "Capabilities" },
    {
      kind: "p",
      text: "Capabilities are a build-time allowlist plus generated platform configuration. Declare them in `lucent.config.ts` (or `lucent.config.json`), one file per app.",
    },
    {
      kind: "code",
      filename: "lucent.config.ts",
      code: 'import { defineNativeConfig } from "@lucent-lang/config";\n\nexport default defineNativeConfig({\n  capabilities: {\n    camera: { reason: "Scan documents" },\n    location: { whenInUse: { reason: "Show nearby stores" } },\n    notifications: { environment: "development" },\n    filesystem: true,\n    crypto: true,\n    network: true,\n  },\n});',
    },
    {
      kind: "list",
      items: [
        "The file is parsed as literal data and never executed. Anything but the outer `defineNativeConfig` call with a literal object is rejected.",
        "`camera`, `microphone`, `photos`, `bluetooth` and `location` need a nonempty usage `reason`, which becomes the Info.plist description. `notifications` takes the APNs `environment`. Library capabilities are booleans.",
        "`build`, `check` and Metro all enforce the allowlist. Unknown capability names fail the build.",
        "Generated outputs: `lucent-manifest.json`, `lucent-platform-config.json`, `ios/LucentInfo.plist`, `ios/Lucent.entitlements` and the Android library manifest. Gradle merges the permissions into the app; the Expo plugin merges plist keys, entitlements and Android permissions during prebuild. In a bare app, merge the plist and entitlement fragments into the app target yourself.",
        "Runtime permission prompts remain the app's job. This is build configuration, not a sandbox.",
      ],
    },
    {
      kind: "p",
      text: "The full table of capabilities and what each generates is in the [config reference](/docs/api/config/).",
    },
    { kind: "h2", text: "Platform guards" },
    {
      kind: "p",
      text: "A binding may declare `platforms: [\"ios\"]` or `[\"android\"]`. Calling it where the other target could reach it is `NT2004`. Guard with `Platform.OS`; the guard narrows `if` branches, `else`, negation and short-circuit expressions, and the analysis follows private helpers. On the unavailable target the binding becomes a throwing stub and its imports are omitted, so both targets still compile.",
    },
    {
      kind: "code",
      filename: "home.lucent.ts",
      code: 'import { Platform } from "@lucent-lang/platform";\nimport { homeDirectory } from "@lucent-lang/sdk/foundation";\n\nexport function home(): string {\n  if (Platform.OS === "ios") {\n    return homeDirectory();\n  }\n  return "";\n}',
    },
    { kind: "h2", text: "SDK bindings" },
    {
      kind: "p",
      text: "Anything not in the standard library comes in through a library manifest: a JSON file with TypeScript declarations (`source`) and Swift and Kotlin bodies per export (`bindings`). Register it in `lucent.config.ts` under an `@lucent-lang/` specifier and import it like any package.",
    },
    {
      kind: "code",
      filename: "lucent.config.ts",
      code: 'import { defineNativeConfig } from "@lucent-lang/config";\n\nexport default defineNativeConfig({\n  libraries: { "@lucent-lang/sdk/math": "./sdk/math/library.json" },\n});',
    },
    {
      kind: "p",
      text: "`lucent sdk` generates manifests from a `.swiftinterface` file or from `android.jar` for scalar free functions and static methods. Manifests can also declare `references` to real SDK classes (construct, get and set properties, call methods) and `views` backed by shipped SwiftUI and Compose adapters. Everything is in the [library manifest reference](/docs/api/library-manifest/).",
    },
    {
      kind: "note",
      text: "Manifest bodies are trusted native build inputs, like any Swift or Kotlin file you add to the project. Lucent validates the metadata; it does not sandbox the code.",
    },
  ],
};
