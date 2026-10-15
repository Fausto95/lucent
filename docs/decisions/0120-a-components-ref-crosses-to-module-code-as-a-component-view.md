# 0120. A component's ref crosses to module code as a ComponentView

- **Date:** 2026-10-15
- **Status:** accepted

A module function takes a component's view as lucent:ui's
`ComponentView` ([T124](../tasks.md#t124)): JavaScript passes the
component's ref (`ref.current`), and module code reads the view with
`viewOf`, which lucent:ios and lucent:android declare, typed as their
platform's view (`UIView`, `android.view.View`).

- **What crosses.** The views runtime records the host view's React tag
  on the ref (`__lucentView`, not enumerable). The binding reads it and
  takes the mount the tag has then, a tag and a generation
  (`lucent::ui::ComponentView`). A value without one is a TypeError. A
  `ComponentView` crosses into Lucent alone: returning one is LUCENT2006.
- **What it names.** The hosts record each mount's root as setup returns
  it (`recordMount`), and forget it as the mount ends. `viewOf` gives the
  view the setup returned (a view controller's view; on Android the
  component's shell for a Fragment root), and an `InvalidStateError` once
  that mount has ended, so a value kept past a reload never reads the next
  runtime's view with its tag. A ref passed before its view mounted (an
  effect right after React's commit) names the tag's first mount.
- **Where.** `viewOf` runs on the main thread alone: the compiler refuses
  it outside `main()` and a component's code (LUCENT3006), and the runtime
  throws off the main thread.
- **As a value.** It is an object to module code: `String()` is
  `[object Object]`, and two are `===` when they name one mount.

_Why:_ view capture, map cameras and other SDK calls take the platform's
view, and JavaScript names a view by its ref alone. The ref is the host
view's own (0105), so its tag is what React Native's own APIs find it by.
Naming the mount rather than the tag is what lets a kept value fail
plainly when the view went. `viewOf` lives in the platform modules
because only they can type its result, and main() because UIKit's and
Android's views are the main thread's.
_Changed:_ [views.md](../design/views.md#a-components-view-in-module-code)
and [limitations.md](../limitations.md).
