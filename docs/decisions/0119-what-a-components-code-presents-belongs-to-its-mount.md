# 0119. What a component's code presents belongs to its mount

- **Date:** 2026-10-15
- **Status:** accepted

`present` from lucent:ios, called while a component's code runs on the
main thread (its setup, a commit, a command, a function its setup made,
up to its first `await`), presents for the component
([T122](../tasks.md#t122)):

- **From its root.** When the setup's root is a view controller (a UIKit
  one, 0118, or a SwiftUI body's hosting controller) in a window with
  nothing presented over it, it presents from it. Otherwise, as from any
  other code, from the top view controller of the scene the person is
  using.
- **Under its mount's scope.** The presentation belongs to the mount's
  scope, not the main context's root scope: a commit keeps it, and the
  mount's end disposes the scope, which dismisses it and rejects the
  promise with an `AbortError`.

Its setup gives the host's content of the mount its scope and root
(`lucent::ui::ownContent`), which `present` finds through the active
content. Code after an `await` runs outside the mount, so it presents as
module code does; a signal `onDispose` aborts still stops it.

_Why:_ a component's command presenting from its own controller is what
UIKit expects of contained content, and what keeps a popover anchored to
it. A modal a component showed and then outlived would answer a
component that has gone. Finding the mount through the active content
covers every way its code runs without new generated code at each call.
_Changed:_ [views.md](../design/views.md#lifetime-and-errors), which said
a presentation belonged to the calling context's root scope.
