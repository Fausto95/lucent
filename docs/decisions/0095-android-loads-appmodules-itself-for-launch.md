# 0095. Android loads the app's appmodules library itself, not a library of Lucent's own

- **Date:** 2026-10-13
- **Status:** accepted

Amends [0092](0092-launch-runs-in-the-apps-launch-and-android-loads-lucent-by-itself.md),
which made Lucent's C++ a shared library of its own, `liblucent.so`, for
Android to load before React Native. Lucent's C++ stays in the app's
`appmodules`, and Lucent loads that library itself when it needs to run
first. `LucentInitializer` calls `System.loadLibrary("appmodules")`, then
`lucent_launch`, in an app whose packages list launch modules. Lucent's
Java classes the OS starts in a cold process will do the same before their
first native call ([T131](../tasks.md#t131)).

React Native's `appmodules` `JNI_OnLoad` only stores the app's module and
component providers, so it can run before React Native starts. Its
dependencies load with it, and their own `JNI_OnLoad` runs when React
Native loads them later. React Native's own load of `appmodules` then
finds it loaded.

_Why:_ autolinking compiles code that calls into Lucent, the C++ module and
its components' descriptors, into `appmodules`. With Lucent in a library of
its own, every symbol that code reaches would need exporting across two
libraries. Android's linker would also give each library its own copy of
an inline function's static, splitting state Lucent keeps once. Loading
`appmodules` early runs the same code in the same library as React Native
does. An app without launch modules loads nothing early, as before.
_Changed:_ 0092's library of its own, and
[native-platform.md](../design/native-platform.md#the-native-root).
