---
"@lucent-lang/lucent": patch
---

Let `expo prebuild` succeed on Linux when a module imports `lucent:android/*`: a build that leaves Android to the Gradle build and has no other platform to build checks the shared code and writes the native package. `lucent check` without any platform SDK now checks the code, with SDK imports untyped, instead of failing with "no platform SDK is installed".
