---
"@lucent-lang/lucent": patch
---

A Lucent object a worklet library copies into its runtime with its native state (as `react-native-worklets` copies objects) is now refused with a `TypeError` where an instance is expected, instead of being used as one: a call in that runtime returns its own object for the instance, with its own prototype. A `JSValue` held from another runtime and given to this one throws a `TypeError` that says so.
