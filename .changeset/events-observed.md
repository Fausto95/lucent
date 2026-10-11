---
"@lucent-lang/lucent": minor
---

Add `EventEmitter.onObserved(name, observer)` to `lucent:core`: the observer is called with `true` when an event gets its first listener, from Lucent or JavaScript, and with `false` when its last one goes, removed or ended by a reload, so a module can start the native source behind an event only while someone listens. The `lucent-sensors` example's new `sensorEvents` emitter uses it to run each sensor only while JavaScript listens.
