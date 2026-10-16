---
"@lucent-lang/lucent": minor
---

An exported Lucent class extending an iOS class now has an Objective-C class the OS can make by name, `LucentApp_<module>_<Class>` (an app extension's principal class names it), instead of a name from its C++ class. When its constructor and its `super()` take nothing, an `init` from the OS or from native code makes its Lucent instance too: module state starts if none lasts and is held while the object lives, the constructor runs holding the module's lock, and `super()` adopts the object the OS made. A module's iOS file may export such a class without its shared file declaring it. Two classes whose names come out the same keep names of the build's, and `LUCENT3016` warns.
