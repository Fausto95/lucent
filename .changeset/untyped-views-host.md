---
"@lucent-lang/lucent": patch
---

Build and check a component on a machine without its platforms' SDKs (`--platforms host`, Linux CI): it's left out there, as other untyped platform code is, instead of failing with LUCENT2001 (`any`) or, for `lucent new view`'s declaration file, LUCENT3004.
