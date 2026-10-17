---
"@lucent-lang/lucent": patch
---

`LUCENT_OUT` moves the native package for every tool, not just Metro: `lucent build` writes it there when `--out` isn't given, so Metro's watcher, the Gradle task and the Expo plugin do too, and autolinking links it, doctor reads it and the Expo plugin reads its app extensions and resolved packages from it. Before, autolinking linked `.lucent/native` while Metro bundled `LUCENT_OUT`'s proxies.
