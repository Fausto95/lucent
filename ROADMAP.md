# Lucent roadmap

Lucent compiles TypeScript modules to C++ that React Native calls through JSI.
The website's [roadmap](https://lucent-lang.dev/docs/roadmap/) is generated
from this file, so each item is one short line.

✅ done · 🚧 in progress · ⏳ next · 🔭 later

## M0: Foundations

Goal: A module runs as C++ in a bare React Native app and an Expo app, on iOS and Android.

- ✅ A C++ runtime with JavaScript's numbers, strings, arrays, maps, sets and errors.
- ✅ One C++ TurboModule, autolinked on iOS and Android.
- ✅ The compiler: the TypeScript checker, then C++ with `#line` back to the source.
- ✅ `lucent build`, the Metro integration and the Expo config plugin.
- ✅ Every language feature tested against the same code run as JavaScript.

## M1: The language

Goal: Self-contained modules, such as parsers, codecs and data structures.

- ✅ Statements, expressions, destructuring and template literals.
- ✅ Object types, unions, narrowing, enums and generics.
- ✅ Classes with inheritance and interfaces, closures, generators, regular expressions and JSON.
- ✅ `async` and `await` off the JS thread, `AbortSignal`, JS callbacks and promises.
- ✅ Lucent code runs one piece at a time, so it has no data races.

## M2: Platform APIs

Goal: Call the iOS and Android SDKs directly from Lucent.

- ✅ SDK types read from your Xcode and Android SDK on first import, then cached.
- ✅ One module for both platforms, with platform branches; platform files as an option.
- ✅ Delegates, listeners and blocks; completion handlers as promises.
- ✅ Android classes extended in Lucent, and Android version checks at compile time.
- ✅ iOS main-thread-only APIs checked at compile time.
- ✅ Libraries the app links: its pods on iOS, its Gradle dependencies on Android.
- ✅ Lucent packages on npm, with `lucent.json` for their native needs.
- ✅ Ports of nine Expo and community modules, checked against the originals.
- ⏳ Android generics, such as `Consumer<T>`, and `java.util` collections.
- ⏳ `Task<T>` and `ListenableFuture<T>` as promises, and the current `Activity`.
- 🔭 Swift-only and Kotlin-only APIs, and subclassing iOS classes.
- 🔭 iOS version checks at compile time.
- 🔭 Weak references, and `using` for sessions and files.
- 🔭 Swift Package Manager libraries.
- 🔭 Pinning an SDK version, and listing what an SDK update changes for your code.
- 🔭 Rarer SDK types, such as pointers and selectors, as ports need them.

## M3: Views

Goal: Native views from Lucent components.

- 🔭 SwiftUI or UIKit views and Compose or Android views, on Fabric.

## M4: Production

Goal: Ready for apps in production.

- ✅ `@lucent-lang/lucent` on npm, published from CI with provenance.
- ✅ Incremental builds, and rebuilds as you edit.
- ✅ Crashes and errors that point at `.lucent.ts` lines.
- ✅ Lucent's errors in the editor.
- 🚧 Performance budgets in CI.
- ⏳ Testing on physical devices; today, simulators and emulators.
- ✅ A JavaScript `lucent:core`, so Jest and Vitest can run shared modules.

## Not planned

- Running JavaScript in native code: there's no JavaScript engine there.
- Reflection, `eval` and prototypes.
- Freeing reference cycles by itself.
