# 0026. Android glue runs on a desktop JVM in tests

- **Date:** 2026-10-03
- **Status:** accepted

T28 executes
an unknown Android library through Lucent's real JNI glue on a JVM the
test starts (the desktop JNI host), not on an emulator: `android.cpp`'s
JNI also builds with `LUCENT_JNI_HOST`, and the host supplies the thread's
`JNIEnv`, the main thread and stand-ins for the two Android classes
Lucent's Java reads. _Why:_ it runs in CI on any machine with a JDK, in
seconds, and catches JNI mistakes (`-Xcheck:jni`); an emulator run needs
the Android build and a device. _Changed:_ views still need Android to
mount, so an Android view's glue is compile-checked there; the emulator
remains the example apps' check (V5).
