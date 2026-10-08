---
"@lucent-lang/lucent": patch
---

A Java class passed as an argument (`Probe.make(Probe)`) is looked up once per call site, not on every call.
