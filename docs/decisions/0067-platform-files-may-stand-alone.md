# 0067. Platform files may stand alone

- **Date:** 2026-10-08
- **Status:** accepted

A split module may have one platform's file: the other platform's build compiles its declarations as the host does, as stubs that throw or reject "not available on Android". Its declaration file may hold the `const`s and enums its platforms share, compiled into each platform's module. A `const` holding a platform test is a platform test, as TypeScript narrows through it; at the top level the host reads `PLATFORM` where it is used, so a module with one still starts on the host. Declared classes in declaration files were left out: a shared class with platform members ([0063](0065-platform-members-not-platform-classes.md)) holds platform objects without a declaration to keep in step with two implementations. _Changed:_ [TA37](../tasks.md#ta37).
