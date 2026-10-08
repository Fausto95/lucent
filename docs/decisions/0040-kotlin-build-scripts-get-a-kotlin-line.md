# 0040. Kotlin build scripts get a Kotlin line

- **Date:** 2026-10-06
- **Status:** accepted

`lucent init`
and the Expo config plugin apply the Gradle task to
`android/app/build.gradle.kts` with a Kotlin DSL line that asks Node
through `providers.exec`, appended at the end of the script. _Why:_ init
printed the Groovy line for a `.kts` script, which does not compile as
Kotlin, and the plugin skipped such scripts silently. _Changed:_ one table
of lines keyed by Expo's language names; any other language is an error.
