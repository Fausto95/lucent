# 0013. One-file components

- **Date:** 2026-09-30
- **Status:** accepted

A component is one `.lucent.tsx`
file: its logic once, its SwiftUI body and its Compose body in `PLATFORM`
branches. Named imports from both toolkits are aliased when they clash.
Split platform files stay supported. _Why:_ the logic is written once
instead of once per platform. _Changed:_ the toolkits' names are platform code (`LUCENT3024` outside
their branch), and a body for one platform only is `LUCENT3023`.
