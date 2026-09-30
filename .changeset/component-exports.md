---
"@lucent-lang/lucent": minor
---

Recognize components: an exported function of a `.lucent.tsx` module that returns a platform view (a UIKit `UIView`, an Android `View`, or a subclass). React can't render them yet. Lucent now checks them and leaves them out of the module's JavaScript. It checks that the view comes back on every path, from one props object of plain data, with callback props named `on…` that return nothing, and that setup code can run on the main thread. The new diagnostics are `LUCENT3020` to `LUCENT3023`. `compile()` lists each component under `components`, identified by package, module path and export name.
