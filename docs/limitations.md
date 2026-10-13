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
- A component's props are data. An instance of an exported class can't be
  a prop yet ([T120](tasks.md#t120)).
- A component takes `style` and its own props only. React Native's other
  view props, such as `testID`, `accessibilityLabel` and `onLayout`, are
  dropped ([T121](tasks.md#t121)).
- A component's root is a view. A `UIViewController` root, such as
  `AVPlayerViewController`, isn't supported yet ([T122](tasks.md#t122)).
- Android pools component views only when the app turns on React Native's
  `enableViewRecycling`. iOS always recycles them.
- Intrinsic sizes and slot insets wait for the JavaScript thread to apply
  them, which takes one layout when it is idle. A component shows its
  previous size, zero at mount, until then.
- A native change no code of the mount makes keeps the old size on iOS,
  and on Android when it asks for no layout. Locale isn't an input of a
  measurement.
- Android's component shell doesn't draw React Native's borders. Views
  made after setup get `appContext()`, not the hosting view's themed
  context ([T125](tasks.md#t125)).
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
- Helper view functions take plain data and scalar callbacks only: no
  toolkit values, children, lists or bindings inside a helper
  ([T123](tasks.md#t123)).
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
- A `WeakRef` to an SDK object, or a `WeakMap` keyed by one, is refused
  ([T112](tasks.md#t112)). A `WeakMap` value that holds its own key keeps
  it, and the entry, for as long as the map lives.
- `Uint8Array` is the only typed array, and `DataView` is refused
  ([T100](tasks.md#t100)).
- `null` and `undefined` from JavaScript are checked apart for arguments,
  setter values and object fields only ([T101](tasks.md#t101)). Inside
  arrays, maps, sets, records, tuples, callback results and promise
  values, `T | undefined` also takes `null`, and `T | null` takes
  `undefined`. Narrowing such a value then throws `TypeError`.
- A recursive union alias, such as a `Json` type of arrays and records,
  crashes the compiler instead of giving a diagnostic
  ([T102](tasks.md#t102)).
- `then`, `catch`, `finally`, `Promise.race`, `Promise.any` and
  `Promise.allSettled` are refused: use `await` and `Promise.all`
  ([T103](tasks.md#t103)).
- There are no `setTimeout`, `setInterval` or `queueMicrotask`: use
  `delay` from `lucent:core` ([T104](tasks.md#t104)).
- `TextEncoder`, `TextDecoder`, `atob`, `btoa`, `URL` and `crypto` are not
  available. `lucent:core` has `utf8Encode` and `utf8Decode`
  ([T105](tasks.md#t105)).
- Refused built-ins give `LUCENT1003` unless noted. They include
  `normalize()`, `locales` and `options` arguments, an error's `cause`,
  `JSON.stringify`'s replacer and indent, `flat()`, resizable
  `ArrayBuffer`s and `new Proxy` ([T106](tasks.md#t106) lifts some).
- Object rest in destructuring (`LUCENT1004`) is refused, and so are
  spread arguments into fixed parameters or from tuples (`LUCENT1007`).
  `for await` gives `LUCENT1009` ([T106](tasks.md#t106)).
- Decorators give `LUCENT1005`, and default exports `LUCENT3003`.
- A class can't extend `EventEmitter` (`LUCENT1005`): hold one in a field
  instead ([T113](tasks.md#t113)).
- On object types, `Object.keys`, `values` and `entries` are refused, and
  so are `for…in` (`LUCENT1009`) and `in` (`LUCENT1002`).
- `new Array(n)` needs a whole `.fill(v)`, even when each index is then
  assigned. `Array.from({ length: n })` needs a map function when elements
  can't be `undefined`. Writing past an array's end throws `RangeError`.
- A declaration file of platform files can't declare a class
  (`export declare class`) ([T106](tasks.md#t106)). A shared class with
  `PLATFORM` branches is the way today.
- A few language features differ from JavaScript without a diagnostic.
  The website lists them under
  [Known gaps](https://lucent-lang.dev/docs/api/language/differences/#known-gaps),
  generated from `apps/website/src/docs/language.ts`.
- A field or variable of an object type read before it is assigned throws
  `TypeError`, where JavaScript reads `undefined`. One of a value type
  reads its default. A `let` read before its declaration runs reads as
  unassigned, not `ReferenceError`.
- Compute tasks are named top-level functions, and safepoints are only in
  module functions' task variants.
- The JavaScript reference of `compute` differs from native in three
  cases. An object's copy loses its `#private` fields, and native throws
  `DataCloneError` for a subclass instance behind a base type. An abort
  after the task ran but before the promise settled rejects natively and
  resolves in JavaScript.
- Module state is process-wide: two runtimes alive at once share it. A new
  `Host` resets it only while no other runtime is live.
- Module code runs only once a JavaScript runtime has installed Lucent.
  Background tasks, services and extensions can't run it yet
  ([T130](tasks.md#t130)).
- An object goes on an executor only if its class does nothing else. It
  is made only in `on()`, isn't exported, extends no class and keeps
  `this` to itself. So a subclass of an SDK class can't go on one
  ([T109](tasks.md#t109)).
- Worklet runtimes can't call Lucent modules ([T134](tasks.md#t134)).
- A delegate that must answer on the main thread waits for the job that
  holds its module's actor. Calls that nest two packages' actors in a
  cycle throw `Lucent: deadlock` rather than hang.
- On iOS, a build doesn't say when a module needs a delegate call the app
  lacks. The app adds the remote notification's and the orientations'
  calls itself ([T110](tasks.md#t110)). On Android,
  `onActivityEvent("newIntent", …)` carries the URLs.
- The app's own `lucent.json` isn't read: only packages declare Info.plist
  keys, entitlements, pods and Gradle dependencies
  ([T111](tasks.md#t111)). Android permissions of the app's own modules
  are still inferred from the SDK.
- Swift's `Data` and `NSData` cross into Lucent as a copy, so a file's or
  a response's bytes reach JavaScript after one copy
  ([T108](tasks.md#t108)).
- On Android API 24 and 25, a Java default method that Lucent doesn't
  implement returns its zero value, and the reason is logged.
- A Lucent package's pod binds once installed. In a bare app, the first
  `lucent build` that meets it declares it in the podspec and fails with
  LUCENT3004 naming the pod. After `pod install`, it binds.
- `expo prebuild` stops at a package pod that isn't installed yet
  ([T141](tasks.md#t141)). A pod binds through the module it defines:
  `DEFINES_MODULE`, modular headers, a prebuilt framework, or
  `use_frameworks!`.
- iOS has no build phase that runs `lucent build`: an Xcode build is
  current after Metro's watcher or `pod install` ran ([T141](tasks.md#t141)).
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

## Not verified yet

- Nothing has run on a physical iPhone or Android phone. Tests run on
  hosts, the iOS simulator and the Android emulator.
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
