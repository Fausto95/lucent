---
"@lucent-lang/lucent": patch
---

Reading a C++ header that includes the standard library no longer fails with `spawnSync clang ENOBUFS` on macOS. clang's AST of such a header is hundreds of megabytes (more with libc++ than with libstdc++), past what Lucent read from clang's output; clang now writes it to a file, read one top-level declaration at a time, and the standard library's namespaces are dropped as they're read.
