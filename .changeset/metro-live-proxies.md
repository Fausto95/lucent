---
"@lucent-lang/lucent": patch
---

Serve each module's latest proxy from a running Metro: a build that rewrites it needs a reload, not a Metro restart, and a module not compiled yet fails the bundle until a build writes it. `withLucent` adds the app's `node_modules` to Metro's `resolver.nodeModulesPaths`, so proxies in a `LUCENT_OUT` outside the app still find `react-native`.
