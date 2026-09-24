import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "table",
    head: ["What", "Android", "iOS"],
    rows: [
      [
        "permissions an SDK method needs",
        "added for you, from the SDK's `@RequiresPermission`",
        "an `Info.plist` usage description, which you add",
      ],
      [
        "other permissions and entries",
        "the app's `AndroidManifest.xml`",
        "the app's `Info.plist`",
      ],
      [
        "asking at run time",
        "`PermissionsAndroid` in JavaScript, or the SDK from Lucent",
        "the SDK from Lucent, such as `requestWhenInUseAuthorization`",
      ],
    ],
  },
  { kind: "h2", text: "Android" },
  {
    kind: "p",
    text: "When a module calls a method the SDK marks with `@RequiresPermission`, `lucent build` adds that permission to the native package's manifest. Android merges it into the app's. Location, network state, vibration and biometrics work this way.",
  },
  { kind: "h2", text: "iOS" },
  {
    kind: "panels",
    panels: [
      {
        label: "Expo",
        blocks: [
          {
            kind: "code",
            filename: "app.json",
            code: `{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription": "Shows where you are on the map."
      }
    }
  }
}`,
          },
        ],
      },
      {
        label: "Bare React Native",
        blocks: [
          {
            kind: "code",
            filename: "ios/<App>/Info.plist",
            code: `<key>NSLocationWhenInUseUsageDescription</key>
<string>Shows where you are on the map.</string>`,
          },
        ],
      },
    ],
  },
  {
    kind: "p",
    text: "Rebuild the app after changing either file. iOS shows a permission prompt only when the app gives the reason for it.",
  },
  {
    kind: "note",
    text: "An app has no `lucent.json`: that file is for packages, to tell the apps that install them what they need. See [Publish a Lucent library](/docs/guides/publish-a-library/).",
  },
];
