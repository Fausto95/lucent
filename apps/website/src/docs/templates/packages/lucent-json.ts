import type { Block, DocFrontmatter } from "../../types";
import { lucentJsonDescription, lucentJsonFields } from "../../../generated/lucent-json";

export const frontmatter: DocFrontmatter = {
  title: "lucent.json",
  description:
    "What a Lucent package's platform code needs from the app: pods, Gradle dependencies, permissions, `Info.plist` entries.",
  kind: "reference",
};

export const blocks: Block[] = [
  { kind: "p", text: lucentJsonDescription },
  {
    kind: "code",
    filename: "lucent.json",
    code: `{
  "ios": {
    "pods": { "LucentAuthKit": "~> 1.0" },
    "frameworks": ["LocalAuthentication"],
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
    head: ["Field", "Type", "Required", "Meaning"],
    rows: lucentJsonFields
      .filter((f) => f.field !== "extensions" && !f.field.startsWith("extensions."))
      .map(({ field, type, required, description }) => [
        `\`${field}\``,
        `\`${type}\``,
        required ? "yes" : "",
        description,
      ]),
  },
  {
    kind: "p",
    text: "Only packages have a `lucent.json`: an app's own is not read. An app adds its pods, Gradle dependencies, permissions and `Info.plist` entries the usual way. Its pods and Gradle dependencies can be imported from `lucent:ios/*` and `lucent:android/*` too.",
  },
  {
    kind: "p",
    text: "This table is generated from the schema at `https://lucent-lang.dev/schemas/lucent.schema.json`, which the package also ships, at `node_modules/@lucent-lang/lucent/schemas/lucent.schema.json`. Point your editor's JSON schema setting at it for `lucent.json` files: the file itself doesn't take a `$schema` field. The `extensions` field has its own page, [Native extensions](/docs/packages/native-extensions/).",
  },
];
