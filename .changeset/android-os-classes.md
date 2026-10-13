---
"@lucent-lang/lucent": minor
---

An exported Lucent class extending an Android class is one the OS can make by name, such as a `Worker`, a `Service` or a `BroadcastReceiver`. Its Java class is `dev.lucent.app.<module>.<Class>`, named from the module's path so it lasts across builds. Its constructor takes the Lucent constructor's parameters, which `super(…)` passes on unchanged. It makes the Lucent instance through the native root when the OS makes the object, and the instance holds module state while it lives. A module's Android file exports such a class without its shared file declaring it. A Lucent class extending an Android class now calls the members it inherits, on its Java object. `lucent.json`'s `android.components[].class` names a component's Lucent class, as `<module path>#<Class>`.
