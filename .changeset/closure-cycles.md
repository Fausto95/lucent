---
"@lucent-lang/lucent": patch
---

A debug build's cycle report now names the closures on a cycle, including an emitter's listeners: `Camera.frames (camera.lucent.ts:4), then the frame listener, then the closure at camera.lucent.ts:9, which captures this, back to the first.` For such a cycle, the hint is to capture a `WeakRef` in that closure. Generated code must be rebuilt (`lucent build`).
