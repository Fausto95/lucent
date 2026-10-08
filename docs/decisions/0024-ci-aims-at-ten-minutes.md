# 0024. CI aims at ten minutes

- **Date:** 2026-10-03
- **Status:** accepted

Every job runs on its own, most
under five minutes: the unit tests in two Linux and three macOS shards
balanced by each file's time (`test-timings.json`), each compiled-code
harness (e2e, budgets, each app check) in a job, the SDK coverage and
the libc++ runtime beside the app builds. C and C++ compile through
ccache (the PATH's compilers on Linux, React Native's wrapper on iOS,
CMake's launcher on Android), saved from main's runs and read by pull
requests; each job keeps its own SDK cache; the app checks keep Gradle's.
At most five macOS jobs run at once, as many as the account allows.
_Why:_ the two long jobs took about an hour, and the parallel jobs then
waited on cold caches and on macOS runners. _Changed:_ on the run of
2026-10-03 every job but the iOS app's took 1 to 8 minutes; that one took
16, extracting the SDK into its first cache of its own and compiling
without a warm ccache, which later runs have.
