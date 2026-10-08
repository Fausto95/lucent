# 0062. Device runs are nightly only, until they are reliable

- **Date:** 2026-10-08
- **Status:** accepted

The iOS simulator and Android emulator runs of the Tests screen no longer run on pull requests and no longer gate the `CI` check: they run nightly and by hand. _Why:_ their first runs in CI failed on simulator and emulator setup rather than on Lucent, and pull requests waited on them. _Changed:_ [0051](0051-ci-runs-what-a-change-needs-and-mains-runs-finish.md)'s device runs on pull requests that change the runtime or the compiler.
