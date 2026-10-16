# 0124. An iOS app extension is a target lucent.json declares, built from the code it reaches

- **Date:** 2026-10-16
- **Status:** accepted

The decision [T133](../tasks.md#t133) starts with: how Lucent code runs in
an iOS app extension (a widget, a notification service extension, a share
extension) with no JavaScript and no React Native.

- **Declaration.** `lucent.json`'s `ios.appExtensions` lists them, in a
  package's file or the app's, as `android.components` lists Android's.
  Each entry has a `kind`, a `name` and the Lucent code it runs. A kind is
  an extension point Lucent writes a target for: `"notificationService"`,
  `"share"` or `"widget"`. The name is the target's, and the last part of
  its bundle identifier (`<app's identifier>.<name>`). An entry may add
  `infoPlist` and `entitlements` keys for the extension alone. Two
  packages declaring one name differently fail the build, as two
  declarations of an Android component do.
- **Principal class.** A notification service or share extension's
  `class` names an exported Lucent class, as `<module path>#<Class>`. It
  extends the SDK class its extension point makes:
  `UNNotificationServiceExtension`, or a `UIViewController`. As
  [0097](0097-exported-classes-extending-android-classes-are-os-made.md)
  does for Android, an exported class extending an iOS class gets an
  Objective-C class the OS can make by name:
  `LucentApp_<module>_<Class>`, every character of the module's name but
  letters and digits becoming `_`. `NSExtensionPrincipalClass` names it.
  When the Lucent constructor takes no parameters, the class's `init`
  makes the Lucent instance through the native root
  ([0090](0090-module-state-resets-only-when-nothing-native-holds-it.md)),
  which holds module state while it lives. A principal class must have
  such a constructor. Two classes whose names come out the same get none,
  with a warning, as entry points do
  ([0094](0094-exports-that-would-share-an-entry-point-get-none.md)).
- **Widget.** A widget's `provider` names an exported class, and its
  `body` an exported function of an iOS JSX file. The provider has
  WidgetKit's three requirements as Lucent methods: `placeholder(): E`,
  `snapshot(): Promise<E>` and `timeline(): Promise<Timeline<E>>`, where
  `E` is a record with a `date: Date` and `Timeline<E>` is
  `{ entries: E[]; reloadAfter?: Date }`. The body is `(entry: E) => View`
  in SwiftUI JSX. Lucent writes the Swift WidgetKit needs: the `@main`
  bundle, a `Widget` with a `StaticConfiguration`, a `TimelineProvider`
  calling the provider's methods through entry points, and an entry type.
  The values the body computes are computed in C++ when the provider gives
  the entry, so the Swift entry holds plain values and its view draws
  them. A widget is drawn once per entry: a signal, a binding or a
  callback in its body is refused.
- **Build.** Each extension is a second native build of the same program,
  without React Native. A pod of the native package, `LucentExtensions`,
  has a subspec per extension. It compiles the JSI-free runtime core, the
  units of the modules the extension's code reaches (the import closure
  of its class, or of its provider and body), its own `lucent_entries.cpp`
  and its Swift. It has no JSI unit, no `rn/` source and no view mount.
  An extension is its own process, with its own module state: starting it
  runs the top level of the modules it reaches, and no other's.
- **API limits.** Bindgen records an SDK member unavailable to app
  extensions (`ios_app_extension` availability, as
  `NS_EXTENSION_UNAVAILABLE_IOS` writes it). Code an extension reaches
  that uses one is refused, naming the extension and the member, even in
  a module the app shares, as Xcode refuses it under
  `APPLICATION_EXTENSION_API_ONLY`. No list is kept. Lucent's own APIs
  that need the app (`present()`, app and scene events) carry the same
  mark in their declarations.
- **Runtime.** The extension build compiles the runtime with
  `LUCENT_APP_EXTENSION`. It leaves out what an extension can't call:
  `UIApplication.sharedApplication` and the observers
  `platform/ios_ui.mm` adds from `+load`, the Expo subscriber and the
  notification delegate of `platform/ios_app_delegate.mm`, and React
  Native's registration.
- **Memory.** A widget extension runs under a limit of a few tens of
  megabytes. The runtime starts each thread at its first use (an actor's
  at its first job, the compute pool at its first task), so an extension
  pays for what its code uses. The fixtures record their resident memory,
  and the budget is 5 MB over the same extension written in Swift.
- **Integration.** The Expo plugin adds each target at prebuild
  (`withXcodeProject`): its sources, Info.plist and entitlements, and a
  Podfile target using its `LucentExtensions` subspec. In a bare app,
  `lucent init` run again adds the targets its project lacks, and
  `lucent build` warns while one is missing.
- **App Groups.** `ios.appGroups` lists group identifiers. The app's
  entitlements and each extension's get them, as
  `com.apple.security.application-groups`, so the app and its extensions
  share `UserDefaults(suiteName:)` and files.

_Why:_ an extension is a target of the app's Xcode project, so its
declaration belongs where the app's other native configuration comes from,
and a package can ship one as it ships an Android component. The OS makes
a principal class by name, which an export gives, as on Android. WidgetKit's
`TimelineProvider` and `Widget` are Swift generics with associated types
and result builders that a Lucent class can't conform to through bindings,
so Lucent writes them and the provider mirrors the protocol's three
requirements, nothing more. A widget's body is SwiftUI JSX, as a
component's is, but there is no mount to compute it from, so the entry is
its only input. Building from the code an extension reaches keeps its
binary and its module state to what it runs, and Swift's own rule for
extension-unavailable APIs is a compile-time refusal, not a branch.
_Limits:_ widgets are static (no configuration intent, no interaction:
App Intents are [T136](../tasks.md#t136)'s), and other extension points
wait for a fixture of their own. _Changed:_
[native-platform.md](../design/native-platform.md#app-extensions-and-widgets)'s
open questions, its open decision 6, and T133's first item.
