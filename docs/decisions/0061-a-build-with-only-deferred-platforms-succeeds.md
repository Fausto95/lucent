# 0061. A build with only deferred platforms succeeds

- **Date:** 2026-10-08
- **Status:** accepted

A build whose platforms are all left to later builds (Android to the Gradle build during `expo prebuild`, iOS without its SDK on Linux) checks the shared code as `--platforms host` does and writes the native package, instead of failing with "no platform to build here"; `lucent check` without any platform SDK checks the same way, after a warning. _Why:_ prebuild failed on Linux and on EAS's Android builders for any module importing `lucent:android/*`, and CI's check hid the code's real problems behind the missing SDKs. _Changed:_ the Expo config plugin builds the platforms prebuild writes (`--platform`); a build with no SDK and nothing deferred still fails.
