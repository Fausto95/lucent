---
"@lucent-lang/lucent": minor
---

Check iOS availability as Android's is checked: an Objective-C or Swift API newer than iOS 15.1 must be used under `available("ios", major, minor?)` (in an `if`, after an early exit, or in `?:` / `&&`), or the build fails with LUCENT3007 instead of crashing on older devices. Swift shims are marked `@available` from what they call, so they compile against the deployment target.
