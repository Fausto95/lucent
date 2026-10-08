# 0039. The Android classpath falls back by variant name

- **Date:** 2026-10-06
- **Status:** accepted

`lucentClasspath` reads the debug variant's compile classpath, with product
flavors the first debug variant by name (the unflavored name first, as
build types like `benchmarkRelease` end like it), and the release
variant's when there is no debug variant; with neither it writes an empty classpath and
says why. _Why:_ a flavored app has no `debugCompileClasspath`, so the
task was never registered and every Gradle build failed on `lucentBuild`'s
dependency. _Changed:_ the task is always registered.
