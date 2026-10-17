---
"@lucent-lang/lucent": patch
---

iOS: an app whose pods are frameworks (`use_frameworks!`, static or dynamic) builds Lucent's pod again. `entry_types.h` is guarded by a macro instead of `#pragma once`, so its framework copy and its source copy, which the generated `lucent_entries.h` reaches by its path, no longer define its types twice in the module.
