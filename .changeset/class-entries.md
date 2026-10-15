---
"@lucent-lang/lucent": minor
---

Exported classes have native entry points: `lucent_<module>_<Class>_new` for the constructor, one per public method, and `_get_<name>` and `_set_<name>` per property, their ancestors' included, each taking the instance first; statics take none. Native code holds an instance as a `lucent_object`, which keeps module state alive until `lucent_release` lets it go, and instances cross inside arrays, records and optionals as `LUCENT_INSTANCE` values.
