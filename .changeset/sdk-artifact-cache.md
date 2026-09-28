---
"@lucent-lang/lucent": patch
---

Extract SDK bindings again only when a library or SDK they were read from changes, not when another dependency is added, the same pods are installed again or the project moves, and bind pods of apps using `use_frameworks!` before their first Xcode build. The first build after upgrading extracts once more.
