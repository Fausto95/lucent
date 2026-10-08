# 0022. `pnpm test` leaves out the slow tests on a workstation

- **Date:** 2026-10-03
- **Status:** accepted

The tests that build and run whole programs with the platforms'
toolchains (Swift and JVM host runs, Mac Catalyst and Hermes view runs,
Gradle) or extract an SDK into an empty cache are listed in
`vite.config.ts`; `pnpm test` skips them, saying so, and `pnpm test:all`
and CI (`CI` set) run them. _Why:_ they set the edit-test loop's length
(minutes where the others take seconds) and rarely fail for a change
that is not theirs. _Changed:_ V1 and the integration gate run
`pnpm test:all`.
