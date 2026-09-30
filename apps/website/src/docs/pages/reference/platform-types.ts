import type { Block } from "../../types";

export const blocks: Block[] = [
  { kind: "h2", text: "iOS" },
  {
    kind: "table",
    head: ["In the SDK", "In Lucent"],
    rows: [
      ["a framework or pod module", '`import { … } from "lucent:ios/UIKit"`'],
      ["class and member names", "Swift's names: `UIDevice.current`, `FileManager.default`"],
      ["nested types", "joined with `_`: `UIImpactFeedbackGenerator_FeedbackStyle`"],
      [
        "methods",
        "Swift's base name, labels dropped: `evaluatePolicy(policy, reason)`. Colliding overloads keep their labels: `resizeHeight`.",
      ],
      [
        "protocol requirements you implement",
        "the base name and labels joined with `_`: `locationManager_didUpdateLocations`",
      ],
      ["initializers", "`constructor`, labels dropped: `new CLLocation(48.85, 2.35)`"],
      ["`T?`", "`T | null`; `nil` where the SDK promises a value throws a `TypeError`"],
      [
        "`NSInteger`, `NSUInteger`, `int64_t`, `uint64_t`, Swift's `Int`, `Int64`, `UInt64`",
        "`bigint`, exact: `list.count` is `3n`; a bigint the type can't hold throws a `RangeError`",
      ],
      ["`int`, `double`, `CGFloat` and other numbers", "`number`"],
      ["enums, C enums", "`enum` members, checked against the SDK when the C++ compiles"],
      ["C functions and constants", "functions and constants: `SecItemCopyMatching`, `kSecClass`"],
      [
        "C structs",
        "object types, copied: `CGRect` is `{ origin: { x, y }, size: { width, height } }`",
      ],
      ["`NSString`, `NSData`, `NSDate`", "`string`, `Uint8Array`, `Date`"],
      [
        "`NSNumber`",
        "the `NSNumber` class: read `doubleValue` (import Foundation); an `Any` holding one reads with `asNumber`",
      ],
      [
        "`NSArray<T>`, `NSSet<T>`, `NSDictionary<NSString, T>`",
        "`T[]`, `Set<T>`, `Record<string, T>`, copied",
      ],
      [
        "`id`, `Any`",
        "`ObjCValue` as a parameter, `NSObject` as a result; read it with `asString`, `asNumber`, `asData`…",
      ],
      ["`throws` (an `NSError **`)", 'a thrown error whose `code` is `"domain:code"`'],
      [
        "an `NSError **` Swift doesn't turn into `throws`",
        "an `Out<Error>` argument, read after the call",
      ],
      [
        "a completion handler",
        "a promise, under the name of Swift's `async` form: `await context.evaluatePolicy(policy, reason)`",
      ],
      ["a block parameter", "a function"],
      ["a protocol", "an interface to `implements`; optional requirements are optional"],
      [
        "`@MainActor`",
        "only inside `main()`, or a block or requirement the SDK calls on the main thread (`LUCENT3006`)",
      ],
      ["a weak delegate property", "kept alive by its owner while set"],
    ],
  },
  { kind: "h2", text: "Android" },
  {
    kind: "table",
    head: ["In the SDK", "In Lucent"],
    rows: [
      [
        "a package of `android.jar` or of the app's Gradle dependencies",
        '`import { … } from "lucent:android/android.os"`',
      ],
      ["class and member names", "Java's names: `Build.MODEL`, `getSystemService`"],
      ["nested classes", "joined with `_`: `Build_VERSION`, `ConnectivityManager_NetworkCallback`"],
      [
        "`getX()` and `isX()` without arguments",
        "also a read-only property: `getDefaultVibrator()` is `defaultVibrator`, `isCharging()` is `charging`",
      ],
      ["references without a `@NonNull` annotation", "`T | null`"],
      ["`Class<T>` parameters", "the class itself: `getSystemService(Vibrator)`"],
      [
        "`long`",
        "`bigint`, exact: `vibrate(20n)`; a bigint a `long` can't hold throws a `RangeError`",
      ],
      ["`int`, `double` and other numbers, `@IntDef` and `@LongDef` constants", "`number`"],
      ["arrays", "`byte[]`, `int[]`, `long[]` (as `bigint[]`), `String[]` only"],
      [
        "an exception",
        "a thrown error whose `code` is the exception's class: `java.lang.SecurityException`",
      ],
      ["an interface with one method to implement", "a function, or a class that `implements` it"],
      [
        "an interface with several",
        "a class that `implements` it; default methods keep their Java body",
      ],
      [
        "a class to extend",
        "`class Watcher extends ConnectivityManager_NetworkCallback`, calling `super()` with no arguments",
      ],
      [
        "APIs newer than API 24",
        'only under `available("android", N)` or `Build_VERSION.SDK_INT >= N` (`LUCENT3007`)',
      ],
      ["`@RequiresPermission`", "the permission is added to the native package's manifest"],
    ],
  },
  { kind: "h2", text: "Not bound yet" },
  {
    kind: "list",
    items: [
      "iOS: pointers, `ObjCBool`, `Selector`, `AnyClass`, generic Objective-C classes and protocol compositions.",
      "iOS: Swift-only APIs, factory initializers, and subclassing iOS classes.",
      "iOS: catching an `NSException`, passing an `Error` to Objective-C, and collections nested in collections.",
      "Android: members of generic classes that use the class's type parameters, such as `Consumer<T>.accept` and `List<E>.get`. Other members of a `java.util` collection, such as `size()`, work.",
      "Android: arrays other than those above, writing Java fields, and the current `Activity`.",
      "Android: a `char` argument to a Lucent function, and a Lucent function returning an object to Java.",
      "Both: SDK objects crossing to JavaScript, and calling a method of an SDK object as a value.",
    ],
  },
  { kind: "p", text: "The [roadmap](/docs/roadmap/) tracks what comes next." },
];
