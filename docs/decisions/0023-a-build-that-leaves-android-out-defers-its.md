# 0023. A build that leaves Android out defers its dependencies

- **Date:** 2026-10-03
- **Status:** accepted

`lucent build --platforms ios` (or `host`) types Android's imports of the
app's dependencies only once a Gradle build has resolved the app's
classpath; before that they are untyped, named in a warning that points
to the Android build, as for an Expo app before `expo prebuild`. _Why:_
such a build skips the resolution, so it failed with LUCENT3004 on a fresh
checkout (seen on CI building the bare example for iOS alone), though
nothing it builds reads those modules' types. _Changed:_ a build that
includes Android resolves them with Gradle as before, and reports a
failed resolution.
