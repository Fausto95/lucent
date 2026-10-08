# 0032. Strings keep an atomic reference count; integer ranges are flow-insensitive

- **Date:** 2026-10-05
- **Status:** accepted

A string is one allocation (or none, up to 15 Latin-1
units), and its reference count stays atomic rather than non-atomic for
strings that never leave the Lucent thread, as the earlier TODO proposed.
Integer inference proves ranges over a local's writes without following
statement order. _Why:_ strings cross threads (compute contexts, the JS
thread), and a non-atomic count measured no faster on the kernels (within
noise on `strings`, `wordCount` and `murmur`) once most of their strings
became inline; a flow-insensitive range needs no control-flow analysis and
already proves the bounded remainders the profiles showed, while staying
sound (`acc += x; acc %= m` is left a double). _Changed:_ T54's string and
representation items.
