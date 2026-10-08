---
"@lucent-lang/lucent": patch
---

The runtime's vendored QuickJS regular expression engine no longer exports `lre_*`, `cr_*`, `dbuf_*` or `unicode_*` symbols (they are prefixed `lucent_` and hidden), so an app that also links QuickJS has no clash. iOS builds the runtime with hidden visibility, as Android did, and an app that links two copies of LucentNative fails at launch with a message naming the problem instead of one silently replacing the other.
