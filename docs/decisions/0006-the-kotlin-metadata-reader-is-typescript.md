# 0006. The Kotlin metadata reader is TypeScript

- **Date:** 2026-09-25
- **Status:** accepted

Lucent ships its
own TypeScript decoder; the official JVM library is the test oracle.
_Why:_ measured on 4,417 real declarations, the two agreed exactly, while
the JVM reader would add 2.8 MB of jars, a prebuilt helper and JDK
discovery to a 0.78 MB CLI. The decoder adds 14 KB and is faster.
