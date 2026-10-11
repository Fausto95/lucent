---
"@lucent-lang/lucent": patch
---

Debug builds count the instances JavaScript collected while they still held something open, a `NativeBuffer` or a native extension's handle, which their release then closed: `host.releasedOpen` in `__lucentDebug.snapshot()` (and `__lucentHost.ownership`). A count that grows is a `close()` missing in JavaScript.
