---
"@lucent-lang/lucent": patch
---

A SwiftUI or Compose callback's arguments are computed when it runs, as JavaScript computes them. In `() => pick(props.title, tapped())`, the setup computes `props.title` and `tapped()` in C++ when the tap calls `pick`, in order and in the component's mount. They were values the setup kept from when what they read last changed, so `tapped()` ran then and not at the tap. A callback may now also pass an instance, `() => play(props.player)`. Its own parameters and literals still cross from Swift or Kotlin.
