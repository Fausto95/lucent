# 0005. The native platform plan and the no-catalog rule

- **Date:** 2026-09-24
- **Status:** accepted

Lucent
aims at a complete native platform (the design specification), and
dynamic discovery is an invariant: no maintained catalog of SDKs, APIs,
views or per-library bindings. _Why:_ installing or upgrading a native
dependency must not need a Lucent release. _Changed:_ the full SDK plan's
Lucent-owned API notes were dropped (metadata and adapters provided by a
project or package stay allowed), and named awaitables were removed
rather than moved into such notes.
