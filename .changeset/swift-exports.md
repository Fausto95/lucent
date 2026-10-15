---
"@lucent-lang/lucent": minor
---

Swift can call a module's exports. The `LucentNative` pod's module has a `public enum` per module, named from its path in upper camel case (`lucent-sync/workers` is `LucentSyncWorkers`), whose static methods are the module's functions, `async throws` for async exports, and whose nested classes wrap the exported classes: a throwing `init`, methods, `get throws` properties with a `set<Name>(_:)` method each, and statics, releasing the instance when the wrapper goes. What Lucent code throws is a `LucentError` with its `name`, `message` and `code`. The pod's public headers are now `lucent_entries.h` and the C types it passes (`lucent/entry_types.h`), so a program with entries makes it a Swift pod. Two modules whose Swift names come out the same get no Swift API, and LUCENT3017 warns.
