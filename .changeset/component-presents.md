---
"@lucent-lang/lucent": minor
---

`present` from `lucent:ios`, called from a component's code before its first `await`, now presents from the component's view controller when its root is one in a window, and belongs to the component: unmounting it dismisses what it presented, and the promise rejects with an `AbortError`. Elsewhere it presents from the scene's top view controller, as before.
