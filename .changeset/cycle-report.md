---
"@lucent-lang/lucent": patch
---

Debug builds name each reference cycle between class instances and objects at teardown (a reload, or the app's end), once, in the platform log. The report lists the fields that close the cycle with their source lines, starting from the cycle's oldest object, and says which field to hold through a `WeakRef`: `[lucent] a reference cycle keeps 2 objects alive: Session.onFrame (camera.lucent.ts:2), then Handler.owner (camera.lucent.ts:9), back to the first. Hold Handler.owner through a WeakRef to break it.` Generated code must be rebuilt (`lucent build`).
