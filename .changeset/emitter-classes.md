---
"@lucent-lang/lucent": minor
---

A class can extend `EventEmitter`, as Expo's shared objects do: each instance of `class Player extends EventEmitter<PlayerEvents>` is an emitter of those events, in Lucent and in JavaScript, where it has `addListener`, `emit`, `listenerCount` and `removeAllListeners` beside the class's own members, and keeps its identity. `onObserved` works per instance.
