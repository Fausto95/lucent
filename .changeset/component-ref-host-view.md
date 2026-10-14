---
"@lucent-lang/lucent": minor
---

Make a component's ref its host view, with its commands on it, as `TextInput`'s ref has `clear()`: `findNodeHandle`, `measureLayout`, Reanimated and Gesture Handler now find a Lucent component by its ref. A command named as a member the host view has (`measureLayout`, `setNativeProps`, the DOM node's) no longer compiles: rename it. `focus` and `blur` may still be commands.
