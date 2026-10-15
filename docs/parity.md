# Parity with Nitro and Expo Modules

What a module author can build with [Nitro Modules](https://nitro.margelo.com)
(0.37) and the [Expo Modules API](https://docs.expo.dev/modules/module-api/)
(SDK 57 and 58), and where Lucent stands on each. The goal is to build any
module either one can, views included, from one `.lucent.ts` or
`.lucent.tsx` source. [ROADMAP.md](../ROADMAP.md) orders the work, and
[tasks.md](tasks.md) defines each task.

Checked on 2026-10-12 against Nitro's docs and source (`main` at
`bcab834`) and Expo's docs and `expo-modules-core` 58.0.15. A row says what
each system lets an author do, not how it does it.

**Legend:** ✅ done on `main` (some of it still waits for a release) · 🟡 partial · ❌ missing · — not offered · "Not stated": the docs don't say.

## Defining a module

| Capability                          | Nitro                   | Expo Modules                     | Lucent                                                 | Task                  |
| ----------------------------------- | ----------------------- | -------------------------------- | ------------------------------------------------------ | --------------------- |
| The API's source of truth           | A `*.nitro.ts` spec     | Swift and Kotlin DSL, TS by hand | ✅ The `.lucent.ts` source; its types are the JS types | —                     |
| Synchronous functions               | ✅                      | ✅ `Function`                    | ✅                                                     | —                     |
| Async functions (promises)          | ✅                      | ✅ `AsyncFunction`               | ✅ on the package's own thread                         | —                     |
| Constants and properties            | ✅ getters and setters  | ✅ `Constant`, `Property`        | ✅ `const`, live `let`, class accessors                | —                     |
| Native objects with identity        | ✅ Hybrid Objects       | ✅ `SharedObject`                | ✅ exported classes                                    | —                     |
| Dispose from JS                     | ✅ `dispose()`          | ✅ `release()`                   | ✅ `[Symbol.dispose]`                                  | —                     |
| Memory pressure hint to the GC      | ✅ `memorySize`         | ✅ `getAdditionalMemoryPressure` | ✅ `NativeSized`, `NativeBuffer`                       | —                     |
| Objects shared across packages      | ✅                      | ✅ `SharedRef`                   | ✅ between Lucent packages                             | —                     |
| Events to JS                        | Callbacks only          | ✅ `Events`, `sendEvent`         | ✅ `EventEmitter`                                      | —                     |
| Events on a native object           | Callbacks only          | ✅ a `SharedObject` emits        | ✅ a class that extends `EventEmitter`                 | [T113](tasks.md#t113) |
| Knowing when JS starts listening    | —                       | ✅ `OnStartObserving`            | ✅ `onObserved`                                        | —                     |
| Module create and destroy hooks     | Constructor, `dispose`  | ✅ `OnCreate`, `OnDestroy`       | ✅ top-level code, `onDestroy`                         | —                     |
| A module of the app itself (inline) | ✅ in the app's project | 🟡 inline modules (experimental) | 🟡 sources yes; native needs only from packages        | [T111](tasks.md#t111) |
| Web implementation                  | —                       | ✅ `registerWebModule`           | ❌                                                     | [T144](tasks.md#t144) |
| Generated TS for the JS side        | ✅                      | 🟡 macOS and Swift only          | ✅ always                                              | —                     |
| Native code calling the module      | ✅ through the specs    | ✅ through the module registry   | ❌                                                     | [T114](tasks.md#t114) |
| Tests without a device              | —                       | ✅ Jest mocks                    | ✅ JS `lucent:core`, JS dev mode                       | —                     |

## Values that cross

| Capability                             | Nitro                 | Expo Modules              | Lucent                                    | Task                  |
| -------------------------------------- | --------------------- | ------------------------- | ----------------------------------------- | --------------------- |
| Numbers, strings, booleans             | ✅                    | ✅                        | ✅                                        | —                     |
| 64-bit integers                        | ✅ `Int64`, `UInt64`  | ✅ BigInt (iOS)           | ✅ `bigint` of any size                   | —                     |
| Arrays, tuples, records, maps, sets    | ✅ (tuples: C++ only) | ✅ (no tuples)            | ✅                                        | —                     |
| Structs with typed fields              | ✅                    | ✅ `Record`               | ✅ object types and interfaces            | —                     |
| Unions and enums                       | ✅ variants, enums    | ✅ `Either`, `Enumerable` | ✅                                        | —                     |
| `null` apart from `undefined`          | ✅                    | ✅ `ValueOrUndefined`     | ✅ everywhere a value comes from          | —                     |
| Untyped JSON-shaped data               | ✅ `AnyMap`           | ✅ dictionaries of `Any`  | ✅ a recursive union alias                | —                     |
| `ArrayBuffer`, without copying         | ✅ owning or borrowed | ✅ borrowed or copied     | ✅ moves and lends; `NativeBuffer`        | —                     |
| Typed arrays other than `Uint8Array`   | — (the `ArrayBuffer`) | ✅ every kind             | ✅ every kind, and `DataView`             | —                     |
| Platform memory as JS bytes            | ✅ `HardwareBuffer`   | ✅ `Data`, `ByteArray`    | ✅ `ByteBuffer`, frames on both platforms | [T108](tasks.md#t108) |
| Native pointers handed to other code   | ✅ via `CustomType`   | —                         | ✅ `NativeHandle`, from platform objects  | —                     |
| `Date`                                 | ✅                    | 🟡 milliseconds           | ✅                                        | —                     |
| Errors with codes                      | ✅                    | ✅ `CodedException`       | ✅ `error(code, …)`, platform codes       | —                     |
| JS callbacks, kept and called later    | ✅ from any thread    | 🟡 in sync functions      | ✅ from any thread                        | —                     |
| JS promises as arguments               | ✅                    | —                         | ✅                                        | —                     |
| Opaque JS values held natively         | ✅ raw JSI            | ✅ `JavaScriptValue`      | ✅ `JSValue`                              | —                     |
| Native objects of other module systems | ✅ Nitro's own        | ✅ Expo's own             | 🟡 held opaque, as `JSValue`              | —                     |

## Threads and execution

| Capability                               | Nitro                  | Expo Modules                         | Lucent                                         | Task                  |
| ---------------------------------------- | ---------------------- | ------------------------------------ | ---------------------------------------------- | --------------------- |
| Work off the JS thread                   | ✅ thread pool, `Task` | ✅ module queue, coroutines, async   | ✅ an actor thread per package                 | —                     |
| The main thread                          | By hand                | ✅ `.runOnQueue(.main)`              | ✅ `main()`, checked at compile time           | —                     |
| Parallel compute with no shared state    | By hand                | By hand                              | ✅ `compute`                                   | —                     |
| Swift `async` and Kotlin `suspend` APIs  | ✅                     | ✅                                   | ✅ as promises, cancelled by `AbortSignal`     | —                     |
| Platform callbacks off the module's lock | By hand                | By hand                              | ✅ `on(executor(…), …)`: no wait for the actor | —                     |
| Bounded streams with backpressure        | By hand                | By hand                              | ✅ `Channel`                                   | —                     |
| Calls from worklet runtimes              | ✅ any runtime         | ✅ `installOnUIRuntime`              | ❌                                             | [T134](tasks.md#t134) |
| Code that runs with no JS runtime        | By hand                | By hand                              | ❌ module state needs a live runtime           | [T130](tasks.md#t130) |
| iOS background tasks                     | By hand                | ✅ `expo-background-task`            | ✅ from a package's launch module              | —                     |
| Android WorkManager, services, receivers | By hand (Kotlin)       | ✅ task consumers, Kotlin            | ✅ Lucent classes the OS makes                 | —                     |
| Background JS tasks                      | —                      | ✅ `expo-task-manager`               | ❌ (Lucent code runs natively instead)         | [T135](tasks.md#t135) |
| iOS app extensions and widgets           | By hand                | ✅ `expo-widgets` (iOS)              | ❌                                             | [T133](tasks.md#t133) |
| App Intents and Live Activities          | By hand                | 🟡 Live Activities in `expo-widgets` | ❌                                             | [T136](tasks.md#t136) |

"By hand" means the author writes the platform code in Swift, Kotlin or
C++ beside the module, which both systems allow. In Lucent the same code
is written in TypeScript against the SDK, so each row is a task.

## App integration

| Capability                                     | Nitro | Expo Modules               | Lucent                                     | Task                  |
| ---------------------------------------------- | ----- | -------------------------- | ------------------------------------------ | --------------------- |
| Foreground and background events               | —     | ✅                         | ✅ `onAppEvent`, `onSceneEvent`, Activity  | —                     |
| Opened URLs, user activities, shortcut items   | —     | ✅ AppDelegate subscribers | 🟡 Android intents only                    | [T110](tasks.md#t110) |
| Push token and remote notifications            | —     | ✅ AppDelegate subscribers | ❌                                         | [T110](tasks.md#t110) |
| Activity results and permission requests       | —     | ✅                         | ✅                                         | —                     |
| Back press, configuration changes              | —     | ✅ Activity listeners      | 🟡 androidx listeners, untested            | [T110](tasks.md#t110) |
| Info.plist keys, entitlements, permissions     | —     | ✅ config plugins          | ✅ `lucent.json`, Expo plugin              | —                     |
| Manifest components (services, receivers)      | —     | ✅ config plugins          | ✅ Lucent, Java or Kotlin classes          | —                     |
| Options the app sets (API keys)                | —     | ✅ config plugin options   | ✅ `lucent.json` options                   | —                     |
| Privacy manifests, `<queries>`, Gradle plugins | —     | ✅ config plugins          | 🟡 `lucent.json`, Expo plugin; unbuilt yet | [T115](tasks.md#t115) |

## Views

| Capability                            | Nitro                   | Expo Modules                     | Lucent                                 | Task                  |
| ------------------------------------- | ----------------------- | -------------------------------- | -------------------------------------- | --------------------- |
| UIKit and Android views               | ✅ Fabric, generated    | ✅ `View`                        | ✅ in preview                          | —                     |
| SwiftUI and Jetpack Compose           | —                       | ✅ through `expo-ui`             | ✅ JSX from the SDKs' declarations     | —                     |
| Typed props                           | ✅ any Nitro type       | ✅                               | ✅ data types                          | —                     |
| Native objects as props               | ✅ Hybrid Objects       | ✅ shared objects                | ✅ instances of exported classes       | [T120](tasks.md#t120) |
| React Native's view props on the view | Not stated              | ✅ the view is an `RCTView`      | ✅ checked on devices                  | [T121](tasks.md#t121) |
| Events with payloads                  | 🟡 `callback()` wrapper | ✅                               | ✅ discrete, continuous, coalesced     | —                     |
| Methods on the view's ref             | ✅ `hybridRef`          | ✅ `AsyncFunction`               | ✅ `expose`, with answers              | —                     |
| React children inside the native view | ❌                      | ✅ subviews; Android `GroupView` | ✅ slots                               | —                     |
| Sizing from native content            | Not stated              | ✅ shadow node proxy             | ✅ `invalidateSize`                    | —                     |
| View recycling                        | ✅ opt in               | ❌                               | ✅ (Android: when the app turns it on) | —                     |
| A view controller as the root         | By hand                 | By hand                          | 🟡 Android's `Fragment` only           | [T122](tasks.md#t122) |
| A view passed to a module function    | ✅ `hybridRef`          | ✅ by view tag                   | ❌                                     | [T124](tasks.md#t124) |
| Native objects in SwiftUI and Compose | —                       | ✅                               | ❌                                     | [T123](tasks.md#t123) |

## Native code and dependencies

| Capability                        | Nitro          | Expo Modules  | Lucent                           | Task                  |
| --------------------------------- | -------------- | ------------- | -------------------------------- | --------------------- |
| The iOS and Android SDKs          | Swift, Kotlin  | Swift, Kotlin | ✅ bound on import, no catalog   | —                     |
| Swift-only and Kotlin-only APIs   | ✅             | ✅            | ✅ generated Swift and Kotlin    | —                     |
| Delegates, listeners, subclasses  | ✅             | ✅            | ✅                               | —                     |
| Pods and Gradle dependencies      | ✅             | ✅            | 🟡 a package's pods fail in Expo | [T141](tasks.md#t141) |
| Swift packages                    | ✅             | ✅            | ✅                               | —                     |
| C libraries                       | ✅ C++         | ✅ by hand    | ✅ typed extensions              | —                     |
| C++ libraries and prefab          | ✅ C++ objects | ✅ by hand    | ❌                               | [T142](tasks.md#t142) |
| The package's own Kotlin and Java | ✅             | ✅            | 🟡 compiled, not typed           | [T143](tasks.md#t143) |
| SDK shapes Lucent still refuses   | —              | —             | 🟡 listed in the task            | [T112](tasks.md#t112) |

## Distribution and tooling

| Capability                               | Nitro              | Expo Modules            | Lucent                                | Task                  |
| ---------------------------------------- | ------------------ | ----------------------- | ------------------------------------- | --------------------- |
| Bare and Expo apps                       | ✅                 | ✅                      | ✅                                    | —                     |
| A tested window of React Native releases | RN 0.75 and later  | One RN per SDK          | 🟡 built nightly, not run             | [T140](tasks.md#t140) |
| Monorepos, upgrades, Release builds      | ✅                 | ✅                      | 🟡 smoke-installed, not a matrix      | [T145](tasks.md#t145) |
| Builds from Xcode alone                  | ✅                 | ✅                      | 🟡 needs Metro or `pod install`       | [T141](tasks.md#t141) |
| A library template                       | ✅ `nitrogen init` | ✅ `create-expo-module` | ✅ `lucent create --template library` | —                     |
| Prebuilt binaries                        | —                  | ✅ Expo's own modules   | ✅ the runtime core                   | —                     |
| Errors in the editor                     | TypeScript only    | —                       | ✅                                    | —                     |
| Crashes that point at the source         | Native lines       | Native lines            | ✅ `.lucent.ts` lines                 | —                     |

## Not part of parity

- **A cross-platform view library.** Lucent doesn't ship cross-platform
  primitives (View, Text, Image), native lists, gestures or animations
  ([decision 0080](decisions/0080-the-plan-is-rewritten-for-parity-with-nitro-and-expo-modules.md),
  issue #29). A component wraps a platform view, a SwiftUI body or a
  Compose body.
- **Apple platforms other than iOS, and Android TV or Wear.** Both systems
  reach them through their podspec or Gradle settings. Lucent targets iOS
  and Android phones and tablets until it reaches parity there.
- **Raw JSI and custom converters.** Nitro's raw methods and
  `CustomType`, and Expo's `Convertible`, extend the bridge in native
  code. Lucent has `JSValue` for opaque values and typed extensions for
  native code.

## Sources

- Nitro: [Hybrid Objects](https://nitro.margelo.com/docs/concepts/hybrid-objects),
  [types](https://nitro.margelo.com/docs/types/primitives),
  [array buffers](https://nitro.margelo.com/docs/types/array-buffers),
  [callbacks](https://nitro.margelo.com/docs/types/callbacks),
  [views](https://nitro.margelo.com/docs/guides/view-components),
  [worklets](https://nitro.margelo.com/docs/guides/worklets),
  [requirements](https://nitro.margelo.com/docs/getting-started/minimum-requirements).
- Expo: [module API](https://docs.expo.dev/modules/module-api/),
  [shared objects](https://docs.expo.dev/modules/shared-objects/),
  [AppDelegate subscribers](https://docs.expo.dev/modules/appdelegate-subscribers/),
  [Android lifecycle listeners](https://docs.expo.dev/modules/android-lifecycle-listeners/),
  [background task](https://docs.expo.dev/versions/latest/sdk/background-task/),
  [task manager](https://docs.expo.dev/versions/latest/sdk/task-manager/),
  [widgets](https://docs.expo.dev/versions/latest/sdk/widgets/),
  [SwiftUI](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/extending/),
  [Compose](https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/extending/),
  [inline modules](https://docs.expo.dev/modules/inline-modules-reference/).
