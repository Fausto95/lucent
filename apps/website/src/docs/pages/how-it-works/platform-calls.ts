import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "diagram", diagram: "platform-call" },
  {
    kind: "code",
    filename: "device.lucent.ts",
    cpp: true,
    code: `import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { Build } from "lucent:android/android.os";
import { main } from "lucent:thread";

export async function model(): Promise<string> {
  if (PLATFORM === "ios") return main(() => UIDevice.current.model);
  else return Build.MODEL ?? "unknown";
}`,
  },
  {
    kind: "p",
    text: "One module holds both platforms. Each platform's build compiles its own branch, and \"See the C++\" shows both results.",
  },
  { kind: "h2", text: "Where the types come from" },
  {
    kind: "p",
    text: "The first time a module imports `lucent:ios/UIKit` or `lucent:android/android.os`, Lucent reads it from your installed Xcode or Android SDK. The result is cached in `~/.cache/lucent` for that SDK version, so later builds reuse it.",
  },
  {
    kind: "list",
    items: [
      "Android: any package of `android.jar`, and of the app's Gradle dependencies. Reading the jar takes a few hundred milliseconds.",
      "iOS: any framework of the SDK, and of the app's pods. A large framework such as UIKit takes about 40 seconds, once.",
      "`lucent sdk prefetch` reads them ahead of time. Without an SDK, that platform's imports are untyped and `lucent build` skips the platform, saying so.",
    ],
  },
  { kind: "h2", text: "What a call compiles to" },
  {
    kind: "list",
    items: [
      "iOS: a message send with the SDK's own selector, in Objective-C++ compiled against the real headers. Enum values are checked against the SDK at compile time.",
      "Android: a JNI call. Class and member IDs are looked up once per call site, and local references are freed after each call.",
    ],
  },
  { kind: "h2", text: "What comes back" },
  {
    kind: "list",
    items: [
      "SDK objects stay in native code. JavaScript never sees them, so return plain values.",
      "A Java exception becomes an error whose `code` is the exception's class. An `NSError` becomes an error whose `code` is `domain:code`.",
      "`nil` or `null` where the SDK promises a value throws a `TypeError`.",
      "APIs marked main-thread only, such as UIKit's, compile only inside `main()` (`LUCENT3006`).",
    ],
  },
];
