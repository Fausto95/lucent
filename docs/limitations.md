# Known limitations

What Lucent doesn't do yet, and what hasn't been verified. A limitation
leaves this file in the commit that lifts it, and one found on the way is
added in the commit that finds it, with the task that tracks it in
[tasks.md](tasks.md). The website's
[roadmap page](https://lucent-lang.dev/docs/releases/roadmap/#known-limitations)
shows the two groups users meet, Views and Language, runtime and bindings,
generated from this file.

## Views

- Views are in preview: their API may change before the view gate closes.
- An instance can't be an event's argument or a command's.
- The check of an instance's members follows them through its class, the
  classes around it and the interfaces they implement. A use through
  another structural type, or a spread, isn't seen.
- A component inside Reanimated's animated views, Gesture Handler's
  detectors or react-native-screens' screens is untested
  ([T121](tasks.md#t121)).
- A component's code presents from its view controller only before its
  first `await`. After it, `present` shows from the scene's top controller,
  and outlives the component unless a signal stops it ([T122](tasks.md#t122)).
- Android pools component views only when the app turns on React Native's
  `enableViewRecycling`. iOS always recycles them.
- Intrinsic sizes and slot insets wait for the JavaScript thread to apply
  them, which takes one layout when it is idle. A component shows its
  previous size, zero at mount, until then.
- A native change no code of the mount makes keeps the old size on iOS,
  and on Android when it asks for no layout. Locale isn't an input of a
  measurement.
- Android's component shell doesn't draw React Native's borders. Views
  made after setup take the hosting view's themed context on a desktop
  JVM, not yet run on the emulator ([T125](tasks.md#t125)).
- A slot inside a native scroll view doesn't scroll with it. Transforms
  between the host and a slot are ignored, and `removeClippedSubviews`
  doesn't apply to slots.
- Android mounts each commit, unless the app turns on
  `enableAccumulatedUpdatesInRawPropsAndroid`.
- A `Flex` inside a stack view sized by Auto Layout has no intrinsic
  size.
- Absolute children of a padded component follow React Native's
  padding-box rule relative to the slot. A fixed-size slot inside a
  component sized by its children is bounded at three reports.
- A helper view shows no list of its own yet ([T123](tasks.md#t123)).
- SwiftUI: a static value named like a method (`Animation.easeInOut`) is
  left out, so write the call. Only closed ranges (`a...b`) are mapped,
  content conditions must be `boolean`, and `Int(x)` traps on NaN or
  infinity.
- SwiftUI: a two-value `onChange` closure doesn't type-check, because
  TypeScript tries the one-value overload first.
- SwiftUI: a member newer than the app's oldest iOS is LUCENT3024, since a
  body checks no availability.
- Compose: class names that clash keep the first package's.
- Native views' JSX: a plain view's children have no layout, and a
  `Flex`'s are Yoga's. A list's item is one element.
- Native views' JSX rules read declarations, not behavior: Android's
  `AdapterView` declares `addView(View, int)` and throws from it.
- A root returned under a runtime condition is chosen once per mount. A
  later change of what the condition read doesn't swap it. A signal read
  there is neither tracked nor warned about (a prop is, LUCENT3021).
- Where a platform's SDK is missing, a component's code for that platform
  is untyped and unchecked. Its diagnostics come only where that SDK is
  installed.

## Language, runtime and bindings

- Reference cycles are not collected (see
  [Not planned](../ROADMAP.md#not-planned)): break them with `WeakRef`, or
  key what one side holds in a `WeakMap`.
- A Lucent class implementing a Swift protocol can't implement its
  subscript requirements (`LUCENT1005`): write the conforming type in
  Swift.
- A module's Swift extensions of another module's Swift types (not its
  Objective-C classes) are not bound ([T112](tasks.md#t112)).
- A `WeakMap` value that holds its own key keeps it, and the entry, for
  as long as the map lives. An SDK object's entry outlives its key until
  the table next doubles, its value with it. A `FinalizationRegistry`
  still refuses SDK objects as targets.
- `new AggregateError` is refused (`LUCENT1003`). Read the `errors` of
  the one `Promise.any` rejects with as `e.errors as Error[]`, since
  TypeScript types them `any`.
- `crypto.subtle` is not available, nor are `URL.createObjectURL` and
  `URLPattern`. `TextDecoder` decodes UTF-8 only: another
  encoding's label is `LUCENT1003`, or a `RangeError` when computed. Its
  options are written in the call.
- Refused built-ins give `LUCENT1003` unless noted. They include
  `normalize()`, `locales` and `options` arguments, a cause that isn't an
  `Error`, a replacer function for `JSON.stringify`, resizable
  `ArrayBuffer`s and `new Proxy` ([T106](tasks.md#t106) lifts some).
- Spread into an SDK call is refused (`LUCENT1001`), and so is `for…of`
  over a tuple (`LUCENT1009`). An async generator's `yield*` takes an
  iterable, not another async generator; its `throw()` and `next(value)`
  are refused (`LUCENT1003`), and so are its `yield`'s value and
  `return v` (`LUCENT1001`). A generator's `yield*` into another that takes
  values of another type, or yields other elements, is `LUCENT1001`.
- Where `TNext` leaves out `undefined`, a generator's `next()` without a
  value gives its `yield` the type's default. An object throws
  `TypeError`. A step's value after the result was reported is the same.
- Decorators give `LUCENT1005`, and default exports `LUCENT3003`.
- On object types, `Object.keys`, `values` and `entries` are refused, and
  so are `for…in` (`LUCENT1009`) and `in` (`LUCENT1002`).
- `new Array(n)` needs a whole `.fill(v)`, even when each index is then
  assigned. `Array.from({ length: n })` needs a map function when elements
  can't be `undefined`. Writing past an array's end throws `RangeError`.
- A field or variable of an object type read before it is assigned throws
  `TypeError`, where JavaScript reads `undefined`. One of a value type
  reads its default.
- Compute tasks are named top-level functions, and safepoints are only in
  module functions' task variants.
- The JavaScript reference of `compute` differs from native in three
  cases. An object's copy loses its `#private` fields, and native throws
  `DataCloneError` for a subclass instance behind a base type. An abort
  after the task ran but before the promise settled rejects natively and
  resolves in JavaScript.
- Module state is process-wide: runtimes and native calls alive at once
  share it. A new `Host` starts it again only when none of them holds it.
- Native code runs a module function without a JavaScript runtime only
  through its entry point. A function gets one only if its parameters and
  result are numbers, booleans, `bigint`s, strings or `Uint8Array`s.
- An Android class the OS makes reaches its base's members only once its
  constructor returns, and `lucent build` doesn't check that a manifest
  component's `class` names one.
- A component whose Android root is a `Fragment` shows nothing in a
  `Modal`: the Activity's `FragmentManager` puts fragments in its own
  window only.
- After `expo prebuild` without an iOS build (on Linux, or before
  `pod install`), an app with components builds twice on Android.
  Prebuild lists components from the iOS build, and the first Gradle
  build reads that list before it writes it.
- App extensions aren't run on a simulator yet, and widgets have no body
  yet ([T133](tasks.md#t133)). The Expo plugin adds an extension's
  target, but a bare app doesn't get one. On iOS, a launch module's
  `BGTaskScheduler` handler runs without JavaScript. Relaunches for background
  URL sessions and silent pushes aren't checked yet
  ([T132](tasks.md#t132)).
- Launch modules start module state, so every module's top level runs at
  launch, not only theirs.
- An object goes on an executor only if its class does nothing else. It
  is made only in `on()`, isn't exported, extends no class and keeps
  `this` to itself. So a subclass of an SDK class can't go on one
  ([T109](tasks.md#t109)).
- A worklet runtime's async calls and later callbacks need the
  scheduler its creator gives with `Host::attach`, and no adapter for
  `react-native-worklets` gives one yet. Until then its async calls
  reject with `NotSupportedError` ([T134](tasks.md#t134)).
- A delegate that must answer on the main thread waits for the job that
  holds its module's actor. Calls that nest two packages' actors in a
  cycle throw `Lucent: deadlock` rather than hang.
- A `UNUserNotificationCenter` delegate the app sets after a module first
  listens for notifications replaces Lucent's, so modules hear none after
  it ([T110](tasks.md#t110)).
- On Android, an Activity that isn't AndroidX's `ComponentActivity`
  reports no configuration change, leave hint or back press, nor a new
  intent outside React Native's ([T110](tasks.md#t110)).
- Swift's `Data` and `NSData` cross into Lucent as a copy, so a file's or
  a response's bytes reach JavaScript after one copy
  ([T108](tasks.md#t108)).
- On Android API 24 and 25, a Java default method that Lucent doesn't
  implement returns its zero value, and the reason is logged.
- A Lucent package's pod binds once installed. In a bare app, the first
  `lucent build` that meets it declares it in the podspec and fails with
  LUCENT3004 naming the pod. After `pod install`, it binds.
- A pod binds through the module it defines: `DEFINES_MODULE`, modular
  headers, a prebuilt framework, or `use_frameworks!`.
- An Android app with product flavors binds the libraries of its first
  debug variant by name. A library only another flavor depends on can't be
  bound.
- Typed extensions are C only: C++ headers, callbacks and cancellation are
  not supported yet ([T142](tasks.md#t142)).
- A package's Kotlin and Java sources are compiled but not typed in
  Lucent. Its Swift sources are, as `lucent:ios/LucentNative`
  ([T143](tasks.md#t143)).
- Tracing records allocations for native buffers only, and its buffer uses
  one mutex: fine for debugging, not for continuous production use.
- Swift calling a module's exports gets a record as a `Dictionary`, which
  keeps no key order ([T114](tasks.md#t114)).

## Not verified yet

- Nothing has run on a physical iPhone or Android phone. Tests run on
  hosts, the iOS simulator and the Android emulator.
- The Swift and Kotlin APIs native code calls modules through have run on
  hosts, with Linux's Swift and the desktop JNI host. The bare example's
  Platform screen checks its own Swift and Kotlin calling one, which the
  device check hasn't run yet ([T114](tasks.md#t114)).
- Fresh apps on the window's releases (React Native 0.85 to 0.87, Expo
  SDK 56 and 57) build and run a short check nightly, on the simulator and
  the emulator. The full Tests screen runs only in the example apps, which
  are on the prerelease lane.
- The actors' iOS and Android glue has run through host tests and the
  example apps, not under stress ([T151](tasks.md#t151)).
- StoreKit's `purchase()` needs a `.storekit` configuration, which only an
  app launched by Xcode applies; the call compiles.
- VoiceOver was checked through Mac Catalyst for the SwiftUI host only.
  TalkBack hasn't been run.
- SwiftUI hosting before iOS 16.4 and iOS 17's behavior are unverified.
  Before iOS 17, RTL traits come from a parent override.
- Rotation hasn't been run for the Compose host.
- A real Android biometric prompt hasn't been shown in a recorded run.
- Hosting inside react-native-screens is untested.
- `toLocaleUpperCase` and `toLocaleLowerCase` were checked for a Turkish
  locale on macOS only. Android's path is compiled, not run.
