# 0109. A package's options are names in its lucent.json, which the app sets

- **Date:** 2026-10-15
- **Status:** accepted

A package declares the values it leaves to the app in its `lucent.json`'s
`options`: option name → `{ description, default? }`. `{{name}}` in an
`ios.infoPlist` value, an `ios.entitlements` value or a field of an
`android.components` entry is the option's value, and a whole `{{name}}`
of a boolean is the boolean. The app's own `lucent.json` sets them under
`packages`: package name → option name → a string or a boolean.

The build fills the references before it merges needs. An option without
a default that the app doesn't set fails it, with the line to add; so do
a value for an option the package doesn't declare, a value for a package
the app doesn't depend on, and a reference to an undeclared option. Only
packages declare options, and only the app sets them.

_Why:_ an API key or a usage string is the app's, while the package knows
where it goes: in its Info.plist key, its manifest's `<meta-data>`. A
reference in the package's own declaration keeps that knowledge there, and
the app writes one value, not the package's whole entry. `{{…}}` collides
with neither Xcode's `$(VAR)` and `${VAR}` nor Gradle's `${placeholder}`,
which an Info.plist or a manifest value may hold as written.
_Changed:_ [T111](../tasks.md#t111), `package-schema.ts`,
`package-config.ts`, `schemas/lucent.schema.json`.
