# 0034. iOS binds a package's pods after their install

- **Date:** 2026-10-06
- **Status:** accepted

An Expo
app whose Lucent package imports a pod its own `lucent.json` declares
binds that pod in an iOS build step that runs once pods are installed,
as Android's `lucentBuild` Gradle task resolves Android's dependencies,
and `expo prebuild` defers iOS binding with a warning while such a pod
is missing from `Podfile.lock`, rather than failing ([TA35](../tasks.md#ta35)).
_Why:_ the config plugin runs `lucent build` before prebuild's own
`pod install`, so the build fails with LUCENT3004 and the plugin throws
before it links the native package: the pod is never installed, and no
step the user can take from there installs it. _Changed:_ TA35 tracks
the work; until it lands, the limitation stays listed.
