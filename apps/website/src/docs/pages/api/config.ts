import type { DocPage } from "../../types";

export const page: DocPage = {
  slug: "api/config",
  title: "@lucent-lang/config",
  description: "`defineNativeConfig` types the app's `lucent.config.ts`: capabilities and registered libraries.",
  blocks: [
    {
      kind: "code",
      filename: "declaration",
      code: 'export interface NativeCapabilities {\n  camera?: { reason: string };\n  microphone?: { reason: string };\n  photos?: { reason: string };\n  location?: { whenInUse: { reason: string } };\n  bluetooth?: { reason: string };\n  notifications?: { environment: "development" | "production" };\n  network?: boolean;\n  filesystem?: boolean;\n  crypto?: boolean;\n  device?: boolean;\n  clock?: boolean;\n  locale?: boolean;\n}\n\nexport interface NativeConfig {\n  capabilities?: NativeCapabilities;\n  /** Paths to library.json manifests, relative to the app root. */\n  libraries?: Record<string, string>;\n}\n\n/** Build tools parse the literal argument; no application code executes during configuration. */\nexport function defineNativeConfig(config: NativeConfig): NativeConfig;',
    },
    {
      kind: "code",
      filename: "lucent.config.ts",
      code: 'import { defineNativeConfig } from "@lucent-lang/config";\n\nexport default defineNativeConfig({\n  capabilities: {\n    camera: { reason: "Scan documents" },\n    filesystem: true,\n    network: true,\n  },\n  libraries: {\n    "@lucent-lang/example-counter": "./native/counter.library.json",\n  },\n});',
    },
    { kind: "h2", text: "Rules" },
    {
      kind: "list",
      items: [
        "One file per app: `lucent.config.ts` or `lucent.config.json`, not both. The `.ts` form is parsed as literal data and never evaluated; only the outer `defineNativeConfig` call, object literals, arrays, strings, numbers and booleans are allowed.",
        "`capabilities` and `libraries` are the only keys.",
        "Library specifiers must start with `@lucent-lang/`. Values are manifest paths relative to the app root, or inline manifests in JSON.",
        "The legacy JSON form `\"capabilities\": [\"clock\"]` is still accepted. It grants build access only and generates no platform configuration.",
      ],
    },
    { kind: "h2", text: "What each capability generates" },
    {
      kind: "table",
      head: ["Capability", "Value", "iOS", "Android"],
      rows: [
        ["`camera`", "`{ reason }`", "`NSCameraUsageDescription`", "`CAMERA`"],
        ["`microphone`", "`{ reason }`", "`NSMicrophoneUsageDescription`", "`RECORD_AUDIO`"],
        ["`photos`", "`{ reason }`", "`NSPhotoLibraryUsageDescription`", "`READ_MEDIA_IMAGES`"],
        ["`location`", "`{ whenInUse: { reason } }`", "`NSLocationWhenInUseUsageDescription`", "`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`"],
        ["`bluetooth`", "`{ reason }`", "`NSBluetoothAlwaysUsageDescription`", "`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`"],
        ["`notifications`", "`{ environment }`", "`aps-environment` entitlement", "`POST_NOTIFICATIONS`"],
        ["`network`", "`true`", "", "`INTERNET`"],
        ["`filesystem`, `crypto`, `device`, `clock`, `locale`", "`true`", "allowlist only", "allowlist only"],
      ],
    },
    {
      kind: "p",
      text: "Outputs land in the generated package: `lucent-manifest.json`, `lucent-platform-config.json`, `ios/LucentInfo.plist`, `ios/Lucent.entitlements` and the Android manifest. The Expo plugin merges them into the app during prebuild. In a bare app, merge the plist and entitlement fragments into the app target and select the entitlements file in Xcode; Gradle merges the Android permissions on its own.",
    },
    { kind: "h2", text: "Enforcement" },
    {
      kind: "p",
      text: "`lucent build`, `lucent check` and the Metro transformer compare each module's required capabilities (declared by the package bindings it reaches) against this allowlist and report `LUCENT2001` for anything missing. Runtime permission prompts stay the app's responsibility.",
    },
  ],
};
