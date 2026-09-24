import type { Block } from "../../types";
import { source } from "../../../generated/examples/linked";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "linked.lucent.ts",
    from: "apps/bare-example/src/sdk/linked.lucent.ts",
    code: source,
  },
  {
    kind: "p",
    text: "A library the app already links is imported like the SDK: a pod's module on iOS, an AndroidX package on Android. This module is from the example apps, which add nothing for it.",
  },
  { kind: "h2", text: "Add a library" },
  {
    kind: "list",
    ordered: true,
    items: [
      "Add it to the app as usual: a pod in `ios/Podfile`, or a dependency in `android/app/build.gradle`.",
      "iOS: run `pod install`. Lucent reads the pods' headers from the app's `Pods` folder.",
      "Android: nothing more. `lucent build` asks Gradle for the app's compile classpath, and caches the answer until the Gradle files change.",
      "Import from `lucent:ios/<Module>` or `lucent:android/<package>`.",
    ],
  },
  {
    kind: "list",
    items: [
      "Swift Package Manager libraries can't be imported yet; CocoaPods ones can ([roadmap](/docs/roadmap/)).",
      "A library in a Lucent package goes in its `lucent.json` instead, so apps get it when they install the package.",
    ],
  },
];
