# M2 design: typed platform bindings

Status: **proposal** (2026-09-23), since largely implemented; what exists is
described in [platform-bindings.md](../platform-bindings.md), and its progress
in [improvement-plan-status.md](../improvement-plan-status.md). The examples
here predate the implementation: `lucent:android/context`, for instance, is
`lucent:android`.

Goal (ROADMAP M2): Lucent code imports platform APIs directly, fully typed,
and they compile to direct native calls:

```ts
// camera.ios.lucent.ts
import { AVCaptureDevice, AVMediaTypeVideo } from "lucent:ios/AVFoundation";

export async function cameraAllowed(): Promise<boolean> {
  return AVCaptureDevice.requestAccessForMediaType(AVMediaTypeVideo);
}
```

```ts
// battery.android.lucent.ts
import { BatteryManager } from "lucent:android/android.os";
import { appContext } from "lucent:android/context";

export function batteryLevel(): number {
  const bm = appContext().getSystemService(BatteryManager);
  return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
}
```

No Swift or Kotlin is generated, and the app keeps one C++ TurboModule. iOS
calls become ObjC++; Android calls become JNI from C++.

## What the SDKs give us (measured)

**iOS (Xcode 27, iOS 27 SDK).**

- `clang -extract-api` (the symbol-graph extractor behind DocC) lists a
  framework's API with categories merged into their classes, typed
  declaration fragments and availability: 450 symbols and 667 KB for
  `AVCaptureDevice.h`, in under a second. It does **not** carry nullability
  or `swift_attr` annotations.
- `clang -Xclang -ast-dump=json` carries both: every type is spelled with
  `_Nonnull` / `_Nullable` (16,645 and 9,673 occurrences for AVFoundation's
  translation unit), and `NS_SWIFT_UI_ACTOR` / `NS_SWIFT_SENDABLE` show up
  as `swift_attr`. A full dump is 417 MB for AVFoundation, and `-fmodules`
  hides imported declarations, so it has to be textual and filtered
  (`-ast-dump-filter=<Name>` returns only the matching declarations).
- AVFoundation has no actor annotations (only `@Sendable`); UIKit marks its
  classes `@MainActor`. Main-thread rules for older frameworks exist only in
  the documentation.

**Android (SDK platform 37).**

- `android.jar` (43 MB) is a stub jar of normal class files. Nullability is
  there as `RuntimeInvisibleAnnotations` / parameter annotations
  (`android.annotation.NonNull` / `Nullable`), and so are `@MainThread`,
  `@UiThread` and `@RequiresPermission`. Generic signatures are in the
  `Signature` attribute. The class-file format is small enough to parse in
  TypeScript, so the build needs no JDK.

## Architecture

```
*.lucent.ts ── import "lucent:ios/X" / "lucent:android/p.q" ──┐
                                                              ▼
           bindgen (packages/bindgen): SDK ──▶ Platform IR (JSON, cached per SDK version)
                                                              │
                   ┌──────────────────────────────────────────┼────────────────────────┐
                   ▼                                          ▼                        ▼
   .lucent/types/lucent-ios-X.d.ts            compiler: IR types become       .lucent/native/{ios,android}/
   (editor + checker; paths mapping)          LTypes ("platform object")      generated glue (ObjC++ / JNI)
```

### Platform IR

One small JSON schema for both platforms, so the compiler has one lowering:

- **classes**: name, superclass, protocols/interfaces, generic parameters,
  instance/static methods, properties (with getter/setter and readonly),
  constructors (`init…` / Java constructors), availability.
- **methods**: native name (selector or JVM name + descriptor), parameters
  with IR types and nullability, return type, `throws` (NSError** out
  parameter or Java checked exceptions), `thread: "any" | "main"`, and
  `asyncShape` when the last parameter is a completion handler.
- **protocols / interfaces**, **enums** (`NS_ENUM`, `NS_OPTIONS`, Java
  `static final int` groups), **constants** (`NS_TYPED_ENUM` strings such as
  `AVMediaTypeVideo`, Java static fields).
- **IR types**: primitives, string, bytes, array/list, dictionary/map,
  object reference (with nullability), block/functional interface, enum, and
  `unsupported(reason)` (becomes a diagnostic only when used).

The IR is produced **on demand**: bindgen enumerates a framework or package
cheaply (symbol graph / jar directory), then resolves full type information
only for the declarations a program imports and their transitive signature
types. Results are cached in `.lucent/cache/bindings/<sdk>/<module>.json`, so
a normal build does not run clang or read the jar.

### Type mapping

| ObjC                                      | Java                                  | Lucent (TypeScript)                                      | Crossing                                               |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `BOOL`, `NSInteger`, `double`, …          | `boolean`, `int`, `long`, `double`, … | `boolean` / `number`                                     | value; `long`/`NSInteger` outside ±2^53 → `RangeError` |
| `NSString *`                              | `String`                              | `string`                                                 | copied (UTF-16 both ways)                              |
| `NSData *`                                | `byte[]`                              | `Uint8Array`                                             | copied                                                 |
| `NSArray<T> *`                            | `T[]`, `List<T>`                      | `T[]`                                                    | copied                                                 |
| `NSDictionary<NSString*, T> *`            | `Map<String, T>`                      | `Record<string, T>`                                      | copied                                                 |
| any other object                          | any other object                      | opaque platform class                                    | reference (ObjC strong ref / JNI global ref)           |
| `_Nullable T`                             | `@Nullable T`                         | `T \| null`                                              | `nil` / `null` ↔ `null`                                |
| `NS_ENUM` / `NS_OPTIONS`                  | `@IntDef` groups                      | `const enum`-like namespace of numbers                   | value                                                  |
| `NSError **` out parameter                | checked exception                     | method throws `Error` (`name` = domain or class, `code`) | —                                                      |
| completion handler `^(T, NSError *)` last | —                                     | `Promise<T>`                                             | resolved on the Lucent thread                          |
| other blocks                              | functional interfaces                 | `(…) => R`                                               | Lucent closure wrapped as block / proxy                |

Unannotated (`null_unspecified` / no annotation) references are typed
`T | null`: safe by default, and `!` documents the assumption.

### Objects, identity and lifetime

A platform object is a `lucent::Ref<PlatformObject>` holding a strong
reference: an ARC `__strong id` in an ObjC++ struct, or a JNI global
reference released on the JVM from any thread. `===` compares the underlying
object (`==` on `id`, `IsSameObject` on Java). Handles never cross to
JavaScript in M2 (a diagnostic, like `AbortSignal` today); modules expose
plain values.

### Calls

The compiler lowers a platform call to a direct call in generated glue:

- **iOS**: `[obj requestAccessForMediaType:… completionHandler:…]` in a
  generated `.mm` file compiled by the existing podspec (`ios/**/*.mm`), with
  `@try/@catch` turning `NSException` into a Lucent `Error`, and the used
  frameworks added to `s.frameworks`.
- **Android**: JNI with class and method IDs cached per process, looked up
  once through the app's class loader (captured on the JS thread), an
  exception check after every call, and the Lucent thread attached to the JVM
  as a daemon. The glue is C++ in `android/generated/`, globbed by the
  CMake template. `appContext()` comes from
  `ActivityThread.currentApplication()` (hidden but on the SDK's allow list).

### Callbacks, delegates and listeners

- **Blocks / functional interfaces** passed as parameters: a Lucent closure
  wrapped as an ObjC block, or a Java object from **one fixed runtime class**
  (`dev.lucent.NativeProxy`, via `java.lang.reflect.Proxy`) whose
  `InvocationHandler` calls back into C++. No per-interface Java is generated.
- **Implementing a protocol / interface** (`class Delegate implements
AVCaptureVideoDataOutputSampleBufferDelegate`): builds on the M1 interface
  work. iOS gets a generated ObjC class per implementing Lucent class that
  forwards to the C++ virtuals; Android reuses the proxy class.
- Callbacks arrive on arbitrary platform threads. They are posted to the
  Lucent thread and run under the Lucent lock like any async job, so Lucent
  code keeps its single-threaded model.

### Threads

Lucent code runs on the JS thread (sync exports) or the Lucent thread (async
work), never on the main thread. Main-thread-only APIs (`thread: "main"`:
`@MainActor` / `@UIActor` on iOS, `@MainThread` / `@UiThread` on Android,
plus a curated override list for frameworks that only document it) are:

- typed as returning `Promise<T>`, and lowered to a hop onto the main
  queue / main `Looper` that `co_await`s the result, releasing the Lucent
  lock while it waits;
- rejected with a diagnostic when called from a synchronous function.

### Per-platform modules

Platform imports live in `*.ios.lucent.ts` / `*.android.lucent.ts`,
matching Metro's platform extensions. When both exist for one module name,
the compiler checks that their exports have identical signatures and
generates one JavaScript proxy; each platform's native package contains only
its own implementation. A `.lucent.ts` file without a platform suffix cannot
import `lucent:ios/*` or `lucent:android/*`.

### Editor support

`lucent build` writes the `.d.ts` for every imported platform module to
`.lucent/types/`. `lucent init` adds a `paths` entry
(`"lucent:*": [".lucent/types/*"]`) to the app's tsconfig, so editors check
platform code with the same types as the compiler.

## Testing

- **Bindgen**: golden IR for a pinned set of headers and classes, checked in
  and compared in CI (macOS runner for the iOS SDK; `android.jar` from the
  Android SDK on Linux).
- **Glue without devices**: Foundation bindings run on macOS (the harness
  links Foundation), and `java.*` bindings run against a desktop JVM through
  JNI on Linux CI. These cover conversions, errors, callbacks and lifetimes.
- **Devices**: platform cases in the example apps (for example
  battery/device model/camera authorization), with expected output supplied
  per platform, run on the simulator and emulator.

## Milestones

1. **M2a**: bindgen IR and cache; iOS: Foundation value types, `NSError`
   throws, class methods and properties (`UIDevice`, `NSProcessInfo`,
   `AVCaptureDevice.authorizationStatusForMediaType`), with per-platform
   module files and generated `.d.ts`.
2. **M2b**: Android: class-file reader, JNI glue, `appContext()`,
   `BatteryManager`, `Build`, `CameraManager` metadata.
3. **M2c**: completion handlers → `Promise`, blocks and functional interfaces,
   the Java proxy.
4. **M2d**: main-thread typing and hops.
5. **M2e**: implementing protocols/interfaces (delegates, listeners).
6. Later: Swift-only APIs (Swift shims via `@_cdecl`), Kotlin-specific
   surfaces (suspend functions, default arguments), AAR dependencies.

## Decisions for the owner

1. **`nil` / `null` as `null`** (proposed) or as `undefined`. `null` keeps
   parity with platform documentation; `undefined` matches how most
   TypeScript code models "absent".
2. **Method names**: the proposal uses the first selector piece, extended
   with later pieces only when that would collide
   (`requestAccessForMediaType`). The alternative is Swift's imported names
   (`requestAccess(for:)`), which are friendlier but need Swift's renaming
   rules and `NS_SWIFT_NAME`.
3. **Platform objects crossing to JavaScript**: not in M2 (proposed), or as
   opaque handles.
4. **`appContext()` via `ActivityThread.currentApplication()`** (proposed),
   or requiring apps to register a context from Java/Kotlin once.
