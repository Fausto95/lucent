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
  { kind: "h2", text: "The app's own lucent.json" },
  {
    kind: "p",
    text: "An app's root can have a `lucent.json` too, with the same fields, for its own modules' needs. The build merges it with the packages', and names the app by its package.json's name.",
  },
  {
    kind: "p",
    text: "Where the app gives a value of its own, the app's wins. That holds for an `Info.plist` key or entitlement, a pod's or Gradle artifact's version, a manifest component and the main Activity's launch mode. An array still joins the packages' values.",
  },
  {
    kind: "p",
    text: "Its `launch` and its components' `class` name the app's modules as they are named, without a package. The pods and Gradle dependencies it lists can be imported from `lucent:ios/*` and `lucent:android/*`, as an app's own can.",
  },
  { kind: "h2", text: "Options the app sets" },
  {
    kind: "p",
    text: "A package can leave a value to the app, such as an API key or a usage string. Its `options` declares each one, with what it means and, when there is one, a default. `{{name}}` in an `Info.plist` value, an entitlement or a manifest component's field is the option's value.",
  },
  {
    kind: "code",
    filename: "lucent.json",
    code: `{
  "options": {
    "apiKey": { "description": "the Maps API key" },
    "usage": { "description": "why the app uses location", "default": "Show where you are" }
  },
  "ios": {
    "infoPlist": {
      "GMSApiKey": "{{apiKey}}",
      "NSLocationWhenInUseUsageDescription": "{{usage}}"
    }
  }
}`,
  },
  {
    kind: "p",
    text: "The app's own `lucent.json` sets them under `packages`, by package. An option without a default that the app doesn't set fails the build, which says how to set it.",
  },
  {
    kind: "code",
    filename: "lucent.json",
    code: `{
  "packages": {
    "lucent-maps": { "apiKey": "AIza…" }
  }
}`,
  },
  {
    kind: "p",
    text: "This table is generated from the schema at `https://lucent-lang.dev/schemas/lucent.schema.json`, which the package also ships, at `node_modules/@lucent-lang/lucent/schemas/lucent.schema.json`. Point your editor's JSON schema setting at it for `lucent.json` files: the file itself doesn't take a `$schema` field. The `extensions` field has its own page, [Native extensions](/docs/packages/native-extensions/).",
  },
];
