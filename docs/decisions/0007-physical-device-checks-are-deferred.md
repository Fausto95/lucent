# 0007. Physical-device checks are deferred

- **Date:** 2026-09-25
- **Status:** accepted

Physical-device
checks (V8) and StoreKit `purchase()` run in a later session by the
maintainer. They are recorded as deferred, never as passed; dependent
tasks continue on simulator, emulator and host evidence and keep the
deferred item listed. _Why:_ no device was available (the iPhone was
offline, and no midrange Android phone was connected), and `purchase()`
needs a StoreKit configuration that only Xcode-launched runs apply.
