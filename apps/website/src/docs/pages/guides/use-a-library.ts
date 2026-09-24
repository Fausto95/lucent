import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "code", filename: "terminal", code: "npm i lucent-haptics" },
  {
    kind: "code",
    filename: "App.tsx",
    code: `import { ImpactFeedbackStyle, impactAsync } from "lucent-haptics";

await impactAsync(ImpactFeedbackStyle.Heavy);`,
  },
  {
    kind: "p",
    text: "`lucent build` finds every Lucent package the app depends on, directly or not, and compiles its modules with the app's. Rebuild the app afterwards, after `pod install` on iOS.",
  },
  {
    kind: "list",
    items: [
      "The package's pods, Gradle dependencies and permissions come with it.",
      "`Info.plist` entries it needs are added by the Expo config plugin. In a bare app, `lucent build` names each missing key: `trip-tracker needs NSLocationWhenInUseUsageDescription in ios/App/Info.plist`.",
      "A package that doesn't support your Lucent version fails the build, and `lucent doctor` says which.",
      'Lucent code can import a package\'s module too: `import { impactAsync } from "lucent-haptics/src/haptics.lucent"`.',
    ],
  },
  {
    kind: "note",
    text: "The example packages, `lucent-haptics` and `lucent-secure-store`, aren't on npm. The example apps install them from the repository, as workspace packages.",
  },
];
