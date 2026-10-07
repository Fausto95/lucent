# Decisions

Decisions that shape Lucent, one file each, newest first below. A file
records what was decided, why (_Why:_) and what it changed (_Changed:_).
A decision changes only by a new one: the new file names the one it
supersedes, and the old file's text stays as it was.

To record one, add `NNNN-<slug>.md` with the next number:

```md
# NNNN. What was decided, as a sentence

- **Date:** YYYY-MM-DD
- **Status:** accepted

What was decided. _Why:_ the reason. _Changed:_ what it supersedes or
changes (decisions by number, tasks by id).
```

and a row at the top of the table below, in the same commit as the work
it shapes. Decisions 0001 to 0047 came from ROADMAP.md's decisions log
(2026-09-23 to 2026-10-07), with their text unchanged.

| Number                                                           | Date       | Decision                                                                    |
| ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| [0050](0050-docs-and-specs-have-one-owner-each.md)               | 2026-10-08 | The website and the contributor specs each own a reader                     |
| [0049](0049-old-docs-urls-redirect.md)                           | 2026-10-08 | Old docs URLs redirect                                                      |
| [0048](0048-the-plan-is-split-into-files.md)                     | 2026-10-08 | The plan is split into files                                                |
| [0047](0047-views-without-a-switch.md)                           | 2026-10-07 | Views without a switch                                                      |
| [0046](0046-ports-keep-their-apis-views-share-state-the-main.md) | 2026-10-07 | Ports keep their APIs; views share state the main thread owns               |
| [0045](0045-a-built-in-is-exact-or-refused.md)                   | 2026-10-06 | A built-in is exact or refused                                              |
| [0044](0044-a-read-before-assignment-throws-never-crashes.md)    | 2026-10-06 | A read before assignment throws, never crashes                              |
| [0043](0043-decorators-and-default-exports-are-refused.md)       | 2026-10-06 | Decorators and default exports are refused                                  |
| [0042](0042-optional-fields-presence-is-refused-not-guessed.md)  | 2026-10-06 | Optional fields' presence is refused, not guessed                           |
| [0041](0041-an-exported-let-is-a-live-binding.md)                | 2026-10-06 | An exported `let` is a live binding                                         |
| [0040](0040-kotlin-build-scripts-get-a-kotlin-line.md)           | 2026-10-06 | Kotlin build scripts get a Kotlin line                                      |
| [0039](0039-the-android-classpath-falls-back-by-variant-name.md) | 2026-10-06 | The Android classpath falls back by variant name                            |
| [0038](0038-metro-bundles-each-proxy-as-a-module-of-its-own.md)  | 2026-10-06 | Metro bundles each proxy as a module of its own                             |
| [0037](0037-the-app-imports-a-component-as-lucent-views.md)      | 2026-10-06 | The app imports a component as `lucent:views/<module>`                      |
| [0036](0036-native-jsx-returns-from-any-of-setup-s-own-code.md)  | 2026-10-06 | Native JSX returns from any of setup's own code                             |
| [0035](0035-sdk-declarations-say-what-the-compiler-checks.md)    | 2026-10-06 | SDK declarations say what the compiler checks                               |
| [0034](0034-ios-binds-a-package-s-pods-after-their-install.md)   | 2026-10-06 | iOS binds a package's pods after their install                              |
| [0033](0033-ci-jobs-time-out-past-their-slowest-runs.md)         | 2026-10-06 | CI jobs time out past their slowest runs                                    |
| [0032](0032-strings-keep-an-atomic-reference-count-integer.md)   | 2026-10-05 | Strings keep an atomic reference count; integer ranges are flow-insensitive |
| [0031](0031-native-views-are-laid-out-by-a-flex-tag.md)          | 2026-10-05 | Native views are laid out by a `Flex` tag                                   |
| [0030](0030-same-typed-swift-initializers-are-static.md)         | 2026-10-04 | Same-typed Swift initializers are static factories                          |
| [0029](0029-the-website-runs-on-docusaurus.md)                   | 2026-10-04 | The website runs on Docusaurus                                              |
| [0028](0028-the-docs-are-four-sections-and-guides-replace.md)    | 2026-10-04 | The docs are four sections, and guides replace the tutorial                 |
| [0027](0027-native-views-jsx-derives-children-no-adapters.md)    | 2026-10-04 | Native views' JSX derives children; no adapters                             |
| [0026](0026-android-glue-runs-on-a-desktop-jvm-in-tests.md)      | 2026-10-03 | Android glue runs on a desktop JVM in tests                                 |
| [0025](0025-ci-reports-the-boundary-and-floor-ratios-a.md)       | 2026-10-03 | CI reports the boundary and floor ratios, a stable machine enforces them    |
| [0024](0024-ci-aims-at-ten-minutes.md)                           | 2026-10-03 | CI aims at ten minutes                                                      |
| [0023](0023-a-build-that-leaves-android-out-defers-its.md)       | 2026-10-03 | A build that leaves Android out defers its dependencies                     |
| [0022](0022-pnpm-test-leaves-out-the-slow-tests-on-a.md)         | 2026-10-03 | `pnpm test` leaves out the slow tests on a workstation                      |
| [0021](0021-ci-runs-its-long-work-side-by-side.md)               | 2026-10-03 | CI runs its long work side by side                                          |
| [0020](0020-separate-the-marketing-homepage-from-the-docs.md)    | 2026-10-03 | Separate the marketing homepage from the docs shell                         |
| [0019](0019-the-structsin1000-budget-is-1-75x.md)                | 2026-10-03 | The `structsIn1000` budget is 1.75x                                         |
| [0018](0018-component-setups-lower-through-the-ir.md)            | 2026-10-02 | Component setups lower through the IR                                       |
| [0017](0017-the-legacy-emitter-s-function-paths-are-retired.md)  | 2026-10-01 | The legacy emitter's function paths are retired                             |
| [0016](0016-the-ir-is-the-default-lowering.md)                   | 2026-10-01 | The IR is the default lowering                                              |
| [0015](0015-the-ir-plans-leaves-with-the-emitter-s-code.md)      | 2026-10-01 | The IR plans leaves with the emitter's code                                 |
| [0014](0014-publish-the-plan.md)                                 | 2026-10-01 | Publish the plan                                                            |
| [0013](0013-one-file-components.md)                              | 2026-09-30 | One-file components                                                         |
| [0012](0012-jsx-for-swiftui-and-compose-with-no-wrappers.md)     | 2026-09-29 | JSX for SwiftUI and Compose, with no wrappers                               |
| [0011](0011-releases-are-squashed-onto-main.md)                  | 2026-09-28 | Releases are squashed onto main                                             |
| [0010](0010-swiftui-and-compose-are-written-in-lucent.md)        | 2026-09-26 | SwiftUI and Compose are written in Lucent                                   |
| [0009](0009-views-are-done-when-swiftui-and-compose-are-done.md) | 2026-09-26 | Views are done when SwiftUI and Compose are done                            |
| [0008](0008-every-native-64-bit-integer-is-a-bigint.md)          | 2026-09-25 | Every native 64-bit integer is a `bigint`                                   |
| [0007](0007-physical-device-checks-are-deferred.md)              | 2026-09-25 | Physical-device checks are deferred                                         |
| [0006](0006-the-kotlin-metadata-reader-is-typescript.md)         | 2026-09-25 | The Kotlin metadata reader is TypeScript                                    |
| [0005](0005-the-native-platform-plan-and-the-no-catalog-rule.md) | 2026-09-24 | The native platform plan and the no-catalog rule                            |
| [0004](0004-full-sdk-plan.md)                                    | 2026-09-24 | Full SDK plan                                                               |
| [0003](0003-cli-and-package.md)                                  | 2026-09-24 | CLI and package                                                             |
| [0002](0002-docs.md)                                             | 2026-09-24 | Docs                                                                        |
| [0001](0001-improvement-plan.md)                                 | 2026-09-23 | Improvement plan                                                            |
