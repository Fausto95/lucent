# 0121. An instance prop stays in C++ in a SwiftUI or Compose body

- **Date:** 2026-10-15
- **Status:** accepted

Amends [0098](0098-an-instance-prop-is-held-from-its-commit-and-checked-by-member.md):
a SwiftUI or Compose body takes instance props
([T123](../tasks.md#t123)), and the instance never crosses into Swift or
Kotlin.

- **What the body shows.** A body shows what the setup computes from an
  instance, as it shows what it computes from any prop: a member's value
  or a method's result is a value slot (`props.player.title`,
  `props.next?.title ?? "none"`), its C++ reading the instance on the
  main thread. It is read again when the prop changes, or a signal it
  read does; an instance's fields are not signals, as in a UIKit or
  Android body's effects.
- **What calls its methods.** A setup function (`const play = () =>
props.player.play()`), which the body's callbacks call. The body
  calling one itself is LUCENT3024.
- **What is checked.** The members a body's values use, as setup code's
  are (0098): what the setup computes for a body is setup code to the
  analyses.
- **Lists.** A body's list shows plain data: a list of instances is
  LUCENT3024 for now, whose message shows the setup function mapping it.

_Why:_ the body is Swift or Kotlin that SwiftUI and Compose evaluate
whenever they like. Calling Lucent code from it (an instance's members
through the Swift and Kotlin exports, decision 0116) would run that code
an unspecified number of times, outside JavaScript's order, and have the
main thread wait on the module while it draws. The setup's slots already
run Lucent code on the main thread at the times JavaScript would, with
the member checks 0098 made, so instances need no machinery of their own.
_Changed:_ [views.md](../design/views.md#instances),
[limitations.md](../limitations.md) and T123's first item.
