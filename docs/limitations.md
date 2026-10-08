# Known limitations and deferred checks

What Lucent doesn't do yet, and the checks no agent can run. A limitation
leaves this file in the commit that lifts it; a new one found on the way
is added in the commit that finds it, with the task that tracks it in
[tasks.md](tasks.md). The website's
[roadmap page](https://lucent-lang.dev/docs/releases/roadmap/#known-limitations)
shows the groups users meet, Views and Language, runtime and bindings,
generated from this file.

## Deferred checks (need the maintainer)

- **Physical devices (V8).** Nothing has run on a physical iPhone or
  Android phone: frame, latency, memory, lifecycle and trace evidence for
  every task, the T10 baselines, the T44 spike's frame results, the TB4
  migration's device run, and RTL on a device.
- **StoreKit `purchase()`.** It needs a `.storekit` configuration, which
  only runs launched by Xcode apply; the call compiles.
- **Pilots.** T68 and T69 need independent library authors and real apps.
- **Accessibility tooling.** VoiceOver was checked only through Mac
  Catalyst for the SwiftUI host; TalkBack and on-device VoiceOver are not
  run.
- **Older iOS.** SwiftUI hosting before iOS 16.4 and iOS 17 behavior are
  unverified (no simulator runtime); iOS before 17 uses a parent override
  for RTL traits.
- **Rotation.** Not run for the Compose host.
- **Android biometric prompt.** Showing a real prompt is not recorded; the
  design's gate for app integration asks for it.
- **react-native-screens.** Not in the example apps, so hosting inside its
  screens is untested.
- **Device-locale casing.** `toLocaleUpperCase`/`toLocaleLowerCase` were
  checked for a Turkish locale on macOS only; Android's JNI path is
  compiled, not run.

## Project infrastructure

- **Vercel.** Both Vercel projects, "website" and "lucent", fail to deploy
  since #128 (2026-10-07), and were rate limited before that, so
  lucent-lang.dev still serves the Starlight site from before #120. The
  repository's build passes from a clean checkout (`pnpm install
--frozen-lockfile && pnpm website:build`, Node 22 and 24, pnpm 9 and
  10). The cause is in the projects' settings or logs, which are the
  maintainer's: `npx vercel inspect <deployment> --logs`. Keep one
  project, with the repository root as its Root Directory and
  `vercel.json`'s settings.

## Views

- Views are in preview: every build generates them since the switch was
  removed (2026-10-07), but the preview gate (G3) has not certified them.
- Android pools component views only when the app turns on React Native's
  `enableViewRecycling`; iOS always recycles them.
- Intrinsic sizes and slot insets wait for the JavaScript thread to apply
  them (one layout when idle).
- Absolute children of a padded component follow React Native's
  padding-box rule relative to the slot. A fixed-size slot inside a
  component sized by its children is bounded at three reports.
- With two React Native runtimes alive at once, requests are answered to
  the runtime that connected last.
- Helper view functions take plain data and scalar callbacks only: no
  toolkit values, children, lists or bindings inside a helper.
- SwiftUI: a static value named like a method (`Animation.easeInOut`) is
  left out, so write the call. Only closed ranges (`a...b`) are mapped,
  content conditions must be `boolean`, and `Int(x)` traps on NaN or
  infinity. A two-value `onChange` closure does not type-check, because
  TypeScript tries the one-value overload first.
- Compose: class names that clash keep the first package's.
- Native views' JSX (T48): a plain view's children have no layout; a
  `Flex`'s are Yoga's ([T50](tasks.md#t50)). A list's item is one element
  ([T49](tasks.md#t49)). Its rules read declarations, not behavior: Android's
  AdapterView declares `addView(View, int)` and throws from it. A root
  returned under a runtime condition is chosen once per mount. A later
  change of what the condition read does not swap it. A signal read there
  is neither tracked nor warned about (a prop is, LUCENT3021).
- Where a platform's SDK is missing, a component's code for that platform
  is untyped and not checked. Its diagnostics (LUCENT3025 for its native
  JSX) come only where that SDK is installed.

## Language, runtime and bindings

- Reference cycles are not collected (see [Not planned](../ROADMAP.md#not-planned)).
- A few language features differ from JavaScript without a diagnostic;
  the website lists them under
  [Known gaps](https://lucent-lang.dev/docs/api/language/differences/#known-gaps),
  generated from `apps/website/src/docs/language.ts`.
- Refused built-ins give `LUCENT1003` unless noted. They are
  `normalize()`, `locales`/`options` arguments, an error's `cause` and
  `new Proxy`; decorators give `LUCENT1005` and default exports
  `LUCENT3003`. On
  object types, `Object.keys`, `values` and `entries` are refused, and so
  are `for…in` (`LUCENT1009`) and `in` (`LUCENT1002`). So is `new
Array(n)` without a whole `.fill(v)`, even when each index is then
  assigned. So is `Array.from({ length: n })` without a map function when
  elements can't be `undefined`. Writing past an array's
  end or growing its `length` throws `RangeError`.
- Compute tasks are named top-level functions; safepoints are only in
  module functions' task variants. The JavaScript reference differs from
  native in three cases. The copy of an object loses its `#private`
  fields, and native throws `DataCloneError` for a subclass instance
  behind a base type. An abort that lands after the task ran but before
  the promise settled rejects natively and resolves in JavaScript.
- Module state is process-wide and reset when a new `Host` is created.
- `null` and `undefined` from JavaScript are told apart for arguments,
  setter values and object fields only. Inside arrays, maps, sets,
  records, tuples, callback results and promise values, a `T | undefined`
  also takes `null`, and `T | null` takes `undefined`. A use of such a
  value then throws `TypeError`.
- A field or variable of an object type read before it is assigned throws
  `TypeError`. JavaScript reads `undefined`, also through `?.`. One of a
  value type (number, string, boolean, tuple, array, map, set, record,
  `Uint8Array`) reads its default. A `let` read before its declaration
  runs reads as unassigned, not `ReferenceError`.
- On Android API 24 and 25, a Java default method that Lucent does not
  implement returns its zero value, and the reason is logged.
- A Lucent package's pod binds once installed. In a bare app, the
  `lucent build` that first meets it declares it in the native package's
  podspec. That build fails with LUCENT3004 and names the pod. After
  `pod install`, `lucent build` binds it, and asks for `pod install`
  again when it adds files. `expo prebuild` stops at that first failure,
  which names no steps. The config plugin builds before the pods are
  installed and before it links the native package. A pod binds through
  the module it defines: `DEFINES_MODULE`, modular headers, a prebuilt
  `.framework` or `.xcframework`, or `use_frameworks!`. A Swift pod
  binds through a module Lucent makes from its sources with `swiftc`, or
  through its public Objective-C headers alone if it has them. Binding a
  package's own pod in an Expo app is [TA35](tasks.md#ta35).
- An Android app with product flavors binds the libraries of its first
  debug variant by name. A library only another flavor depends on is not
  bindable.
- Typed native extensions: Kotlin sources in a package are not typed
  yet (Swift ones are `lucent:ios/LucentNative`), and extension calls
  cannot be cancelled.
- Tracing records allocations for native buffers only, and its buffer
  uses one mutex: fine for debugging, not for continuous production use.
