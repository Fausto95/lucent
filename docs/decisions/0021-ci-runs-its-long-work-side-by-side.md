# 0021. CI runs its long work side by side

- **Date:** 2026-10-03
- **Status:** accepted

Linux has three jobs
(unit tests; the runtime and JSI host tests; e2e, budgets and app
checks), and macOS runs the tests that need the iOS SDK in two shards
beside the app build; two local actions set the workspace up and
restore or build Hermes. The harnesses build in parallel too: the
runtime tests compile the runtime once for all their binaries, e2e
builds its cases side by side, and the Swift and Catalyst harnesses
share the SDK cache and the runtime's objects. _Why:_ the two long jobs
took about an hour each, step after step, and most of it was the same
work done again (the runtime compiled for every test binary, the SDK's
symbol graphs extracted for every Swift program, framework names read
from the cache thousands of times per compile). _Changed:_ on an 11-core
Mac the runtime tests went from 426 s to 26 s, e2e from 424 s to about
40 s, and the unit tests from 588 s to 495 s (5,374 s to 4,618 s of
work); the checks and what they cover are the same.
