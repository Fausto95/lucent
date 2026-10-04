---
"@lucent-lang/lucent": patch
---

Bind the Swift packages an app adds to its Xcode project: Lucent reads the project and Package.resolved, builds each package's library products at its pinned version for the simulator, binds their modules by rule, and links the ones the code imports into LucentNative (add the package to the project without adding its product to the app target, which would link it twice). iOS declarations are now read for the app's deployment target (`IPHONEOS_DEPLOYMENT_TARGET`), so an API the app's target already has no longer needs an `available("ios", …)` check, and one newer than it does.
