# Expanding Lucent's native surface

Status: implementation in progress. SDK reference bindings, synchronous native
function callbacks, package-defined native views/adapters, native package source
and dependency wiring, controlled inputs, typed view events, and layout wrappers
are implemented. The example packages demonstrate adapter-owned native state.
Automatic SDK overload resolution, delegate syntax, async object lifetime rules,
Lucent-owned state/keyed composition, the camera acceptance feature, and broader
structured metadata extraction remain outstanding. This document does not claim
complete native SDK coverage.

## Direction

Lucent should let an application implement a camera pipeline, media editor,
Bluetooth controller, map, or custom interactive view in `.lucent.ts` and
`.lucent.tsx`. A small shared component catalog cannot provide that reach by
itself. Users need access to native objects and extensible native UI.

NativeScript is a useful reference for SDK metadata: its build process gathers
supported classes, interfaces, protocols, functions, and other symbols from
platform and third-party libraries. Its runtime uses that metadata to expose
native APIs. Lucent should resolve typed native symbols at compile time and
emit direct Swift/Kotlin calls. It retains its AOT model and has no JavaScript
runtime on the native side.

Expo UI is a useful reference for composing native SwiftUI/Compose controls,
modifiers, and platform-specific APIs. Lucent should offer shared controls,
platform-specific controls, and a way to register custom native views.

References:

- [NativeScript metadata](https://docs.nativescript.org/guide/metadata)
- [Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/)
- [SwiftUI modifiers](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/modifiers/)
- [Compose modifiers](https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/modifiers/)

## What exists today

- `.lucent.ts(x)` compilation, relative imports, both native backends and hosts.
- Lucent-defined native classes with managed JS handles and private scalar state.
- Async functions, owned buffers, typed events, explicit thread decorators.
- Platform guards and literal capability configuration.
- SDK extraction for scalar Swift free functions and Java static methods.
- Shared views: `VStack`, `HStack`, `Text`, `Spacer`, and `Button`.

`Column` is now `VStack`; `Row` is now `HStack`. Android still emits Compose's
native `Column` and `Row`. This is a change to Lucent's public API names, with
no change in stack orientation.

Shared-object machinery now supports Lucent-defined classes and SDK reference
bindings. Render functions remain pure. View callbacks support void, string,
boolean, and number payloads. Source code cannot yet implement native
protocols/delegates or own reactive component state directly. Package adapters
can supply stateful native views without extending the compiler primitive table.

## One native symbol model

Extend the SDK schema to describe constructors, instance/static methods,
properties, enums, option sets, records, protocols/interfaces, callbacks,
generic arguments, nullability, ownership, thread requirements, and platform
version availability. Give every declaration and overload a stable identity.

Use structured toolchain metadata as the extraction source: Swift symbol
graphs and Clang declarations on Apple platforms; JVM class signatures,
annotations, and Kotlin metadata on Android. Keep the existing small text
extractors as limited import tools. They are insufficient as the foundation
for complete SDK coverage.

Separate three compiler representations:

| Representation   | Meaning                                               | Boundary behavior                                |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------ |
| Native value     | Scalar, record, enum, option set, supported container | Typed conversion/copy                            |
| Native reference | SDK instance with identity and ownership rules        | Opaque managed handle when exposed to JS         |
| Native callback  | Typed callable with execution/lifetime metadata       | Native closure/listener or asynchronous JS event |

A native reference must hold the actual SDK object. Native-to-native calls
operate directly on that object. The JS handle registry is needed when an
object crosses into app JavaScript. Encoding an SDK object as a numeric field
inside a generated value record would hide its ownership and type from the
compiler and is not the intended design.

Overload resolution must happen before lowering. Unknown, unavailable, or
ambiguous calls must fail with a source diagnostic. Availability checking needs
minimum iOS/Android API versions in addition to the existing OS guards.

## Native lifetimes and callbacks

Support constructors, property access, method calls, and explicit release for
SDK references first. Track owned, borrowed, and retained references. Keep a
reference alive across an async operation; reject a borrowed reference that
escapes its valid scope. Define thread confinement per object instead of using
a single global lock for every SDK operation.

Then add callbacks and protocol/interface implementations. Native delegates
may require synchronous return values, so they must execute as compiled native
code. Notifications sent to React can use typed events. Specify callback
retention, unsubscribe/dispose, cancellation, exception handling, and executor
rules as part of the ABI.

Native class inheritance and overrides need explicit base-constructor calls,
method identity, virtual dispatch, and lifecycle rules. They should be modeled
in IR rather than expressed as arbitrary string templates.

## Three UI surfaces

Proposed import surfaces:

| Surface                   | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `@lucent-lang/ui`         | Shared layout and controls with documented cross-platform semantics |
| `@lucent-lang/ui/swiftui` | SwiftUI-specific views, modifiers, and bindings                     |
| `@lucent-lang/ui/compose` | Compose-specific controls, modifiers, and state                     |

All authoring remains in `.lucent.tsx`. Platform-specific imports must be
restricted to the matching target through target-specific modules or compiler
selection. Custom native view registration should support both UIKit/Android
Views and SwiftUI/Compose content, with mount, update, layout, and disposal.

The shared layer needs:

- Typed modifiers with ordered composition, including layout, appearance,
  accessibility, gestures, and animation. Modifier order must be preserved.
- Typed callback payloads for text input, selection, toggles, sliders, gestures,
  and scroll changes.
- Native state with stable component identity, predictable initialization,
  updates, invalidation, and teardown.
- Conditional content, keyed collections, slots/children, and reusable
  components. Keyed native state must survive reordering correctly.
- Native references for imperative operations such as focus, scrolling,
  camera control, and media playback.

Shared controls should document deliberate semantic mappings. APIs that have
no useful shared meaning belong in the platform-specific surface. A common
name must not silently erase platform behavior or availability constraints.

## Native package extension point

A native package should supply its schema, TypeScript declarations, native
implementation/adapter sources when needed, view descriptors, capabilities,
platform dependencies, and minimum SDK versions. The integration layer owns
CocoaPods/SwiftPM/Gradle wiring; the compiler consumes validated metadata only.

SDK coverage should grow through package manifests and generated metadata.
Applications should not need a Lucent compiler fork to register a custom view
or native API. Backends remain responsible for lowering validated IR, and Expo
and Nitro remain host adapters.

## Implementation order and acceptance criteria

1. **SDK references and overloads.** Import an actual SDK class, construct it,
   read/write a property, call an instance method, and verify identity and
   release. Run native tests on both platforms, including wrong-thread,
   overload ambiguity, and use-after-dispose failures.
2. **Callbacks, delegates, and retained async references.** Implement a native
   listener with a synchronous return where required; forward typed events to
   React. Test cancellation, callback retention, teardown, and errors.
3. **Extensible views and modifiers.** Compile a third-party native view
   descriptor without changing the compiler's primitive table. Verify both
   hosts, ordered modifiers, prop updates, event payloads, layout, and unmount.
4. **Native state and composition.** Add controlled inputs, conditional
   content, keyed collections, and component state. Verify state identity,
   updates from callbacks, thread confinement, and cleanup.
5. **Real vertical feature.** Build a camera preview with start/stop, permission
   handling, native frame processing, events, and mount/unmount cleanup using
   AVFoundation and CameraX adapters. Exercise repeated mount/unmount and
   background/foreground transitions. Keep frame buffers native; send compact
   results to React.
6. **Broaden metadata coverage.** Add SDK enums/options, common generic
   specializations, inheritance, more framework declarations, and third-party
   libraries, with precise unsupported diagnostics and native compilation tests.

The camera feature is an acceptance test for the architecture: it requires
objects, delegates, native buffers, concurrency, permissions, and native UI
working together. Additional visual primitives can be added alongside this
work, but they do not establish that interoperability by themselves.
