# 0132. A package's Kotlin and Java are compiled on the build machine, to be bound as the jars they make

- **Date:** 2026-10-16
- **Status:** accepted

How a package's own Kotlin and Java sources are typed in Lucent
([T143](../tasks.md#t143)), as its Swift is as `lucent:ios/LucentNative`.

- **What is bound.** The `.kt` and `.java` files of `android.nativeSources`
  compile into one jar, against the platform's `android.jar` and the app's
  resolved classpath. Each Java package they declare is a module,
  `lucent:android/<package>`, bound from that jar as a library's is.
- **When.** The jar is built the first time Lucent code imports one of
  those packages, and kept in the SDK cache under a key of the sources'
  contents, the classpath's and the compilers'. Gradle still compiles the
  same sources into the app.
- **The compilers.** Kotlin compiles first, with `$KOTLINC`, else the
  Kotlin compiler the app's Gradle build resolved (recorded with its
  classpath), else `kotlinc` on the `PATH`. Java compiles after it, against
  its classes, with the JDK's `javac` (`$JAVA_HOME`'s, else the `PATH`'s).
- **Failures.** Sources that don't compile make each of their modules
  missing, with the compiler's errors in the diagnostic, as a Swift module
  that doesn't build does. Kotlin sources with no Kotlin compiler to compile them
  say so, with how to install one.

_Why:_ binding from class files reuses everything that binds a library:
Kotlin metadata, nullability, API levels. Only compiled classes say what
the sources declare (Kotlin's inferred types, its defaults), so they are
compiled where the build runs, with the app's own Kotlin compiler when
Gradle has resolved it. _Limits:_ the classpath has no `R` class and no
compiler plugins run, so sources that need them aren't bound.
