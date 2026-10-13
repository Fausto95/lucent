---
"@lucent-lang/lucent": minor
---

A package's lucent.json can list `launch` modules, created at app launch before the first frame so they can register what the OS requires by then. Creating one starts module state and holds it for the app's process, so a reload keeps it. On iOS, `LucentAppDelegate`'s `application(_:didFinishLaunchingWithOptions:)` creates them, and `lucent build` warns when a bare app's delegate doesn't forward that call. A listed path that is no module of the package fails with LUCENT3015. Android doesn't create them yet.
