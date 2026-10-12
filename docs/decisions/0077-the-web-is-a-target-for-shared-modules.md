# 0077. The web is a target for shared modules

- **Date:** 2026-10-12
- **Status:** accepted

`web` is a Lucent target. On web, Metro resolves a module's proxy to the
module run as JavaScript, as JavaScript dev mode runs it
([0060](0060-js-dev-mode-runs-modules-as-javascript.md)), with the
JavaScript `lucent:core`, and `lucent:platform`'s `PLATFORM` is `"web"`. A
module whose code uses a platform supplies its exports on web through a
`*.web.lucent.ts` twin, a platform file whose code is ordinary TypeScript
(a `localStorage` store for a key-value package, say); without one, using
the module on web fails with a diagnostic naming the platform code. Views
are not available on web (a diagnostic). _Why:_ Expo's `registerWebModule`
and react-native-mmkv's `localStorage` fallback let a library serve React
Native Web apps, and a Lucent package had no way to; shared code already
runs as JavaScript in dev mode, so the web costs a resolution rule and the
twins, not a new backend. _Changed:_ [TA46](../tasks.md#ta46).
