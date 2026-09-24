import type { Block } from "../../types";
import { lucentJsonDescription, lucentJsonFields } from "../../../generated/lucent-json";

export const blocks: Block[] = [
  { kind: "p", text: lucentJsonDescription },
  {
    kind: "code",
    filename: "lucent.json",
    code: `{
  "$schema": "https://lucent-lang.dev/schemas/lucent.schema.json",
  "ios": {
    "pods": { "LucentAuthKit": "~> 1.0" },
    "infoPlist": { "NSFaceIDUsageDescription": "Unlock with Face ID" }
  },
  "android": {
    "dependencies": { "androidx.biometric:biometric": "1.1.0" },
    "permissions": ["android.permission.USE_BIOMETRIC"]
  }
}`,
  },
  {
    kind: "table",
    head: ["Field", "Type", "Meaning"],
    rows: lucentJsonFields.map(({ field, type, description }) => [
      `\`${field}\``,
      `\`${type}\``,
      description,
    ]),
  },
  {
    kind: "p",
    text: "Only packages have a `lucent.json`: an app's own is not read. An app adds its pods, Gradle dependencies, permissions and `Info.plist` entries the usual way. Its pods and Gradle dependencies can be imported from `lucent:ios/*` and `lucent:android/*` too.",
  },
  {
    kind: "p",
    text: "The schema ships in the package, at `@lucent-lang/lucent/schemas/lucent.schema.json`, and this table is generated from it.",
  },
];
