---
"@lucent-lang/lucent": patch
---

Bind the Swift packages an app adds in Xcode: Lucent reads the app's Xcode project and Package.resolved, builds each linked package at its pinned version for the simulator, and binds its modules by rule; the generated pod links the ones the code imports. iOS declarations are now read for the app's deployment target (`IPHONEOS_DEPLOYMENT_TARGET`), so an API the app's target already has no longer needs an `available("ios", …)` check, and one newer than it does.
