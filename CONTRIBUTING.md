# Contributing to Lucent

## Setup

- Node 24 (the version in `.node-version`) and pnpm 9 (`corepack enable`),
  then `pnpm install` and `pnpm build`.
- The `lucent` command in the repository runs the bundle in
  `packages/lucent/dist`, like the published package. `pnpm build` refreshes
  it (a cache hit when nothing changed); `pnpm test` and `pnpm lucent …` build
  first. `pnpm dev` rebuilds on every change to the CLI, compiler or bindgen;
  after editing `packages/runtime` or the compiler's `lib/`, run `pnpm build`.
- For the native suites, a Hermes build at `~/hermes` (or `HERMES_DIR`):

  ```sh
  git clone https://github.com/facebook/hermes ~/hermes
  cmake -S ~/hermes -B ~/hermes/build -G Ninja -DCMAKE_BUILD_TYPE=Release
  ninja -C ~/hermes/build hermesvm jsi
  ```

  Without a system CMake and Ninja, the Android SDK's work:
  `PATH=~/Library/Android/sdk/cmake/3.22.1/bin:$PATH`.

- For platform code and the example apps: Xcode with an iOS simulator,
  CocoaPods, the Android SDK and NDK, and JDK 17 to 21. Export
  `ANDROID_HOME`, and `LANG=en_US.UTF-8` before `pod install`.
- `pnpm lucent doctor --root apps/bare-example` checks the machine.
- Formatting (Oxfmt) and lint (Oxlint) are configured in `vite.config.ts`;
  `pnpm fix` applies both. VS Code recommends the Oxc extension, which
  formats on save. `git config blame.ignoreRevsFile .git-blame-ignore-revs`
  keeps the one reformatting commit out of `git blame` (GitHub skips it
  already).

The repository layout, and the rules every change follows, are in
[AGENTS.md](AGENTS.md).

## Tests

| Command                                       | Checks                                                                                  | Needs  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| `pnpm test`                                   | compiler, CLI and website unit tests, without the slow ones                             |        |
| `pnpm test:all`                               | the unit tests with the slow ones (as CI runs them)                                     |        |
| `pnpm test:runtime`                           | the C++ runtime; `SANITIZE=1` (ASan, UBSan) or `SANITIZE=thread` (TSan), with `CXX=g++` |        |
| `pnpm test:e2e [case…]`                       | each language feature, native against JavaScript                                        | Hermes |
| `node scripts/app-check.ts apps/bare-example` | an example app's bundle against its C++                                                 | Hermes |
| `node scripts/bench.ts --check`               | performance budgets                                                                     | Hermes |
| `node scripts/smoke-install.ts`               | the packed package, installed alone in a fresh app                                      |        |
| `pnpm typecheck`                              | the repository's TypeScript                                                             |        |
| `pnpm check`                                  | formatting (Oxfmt), lint (Oxlint) and `pnpm typecheck`                                  |        |
| `node scripts/website.ts --check`             | the website (below)                                                                     | Vale   |

CI shards the unit tests by how long each file takes on each runner's
platform (`config/test-timings.json`, read by `config/vitest.sequencer.ts`).
After adding or much changing slow tests, refresh the platform's entry with
`node scripts/test-timings.ts <report.json>…`: on a full local run's JSON
report, or on the `unit-test-report-*` artifacts of a CI run (with
`--platform darwin` for the macOS shards).

`pnpm test:runtime`, `pnpm test:e2e`, the app checks and the benchmarks
build side by side, one compiler per core; `LUCENT_TEST_JOBS` (and, for
e2e's cases, `LUCENT_E2E_JOBS`) set how many.

[docs/testing.md](docs/testing.md) explains the differential suites. Device
runs (`.github/workflows/devices.yml`, with `scripts/device-check.ts`) open
the bare example's Tests screen on the iOS simulator and an Android
emulator and wait for its verdict: nightly, on pull requests that change
the runtime or the compiler, and before a release.

### What CI runs

A pull request runs the jobs its files can affect: `scripts/ci-changes.ts`
maps paths to jobs (a docs-only change runs the Linux unit tests; a
website change adds the website job; a change under `packages/` runs
everything but the device runs), and a path it doesn't place runs
everything. The one check to require is **CI**, which passes when every
job passed or was skipped. A push to `main` and the nightly run run every
job; the nightly one adds `sdk coverage --all`. Main's runs are never
cancelled: each one gates the release that follows it.

## Commits

- Conventional Commits, in the imperative, with a title of 50 characters or
  less that says what the change brings. The body says why, wrapped at 72.
- One unit of meaning per commit. A test lands in its own commit, failing,
  before the commit that makes it pass.
- Living docs change in the same commit as the behavior they describe:
  `docs/`, the website, `ROADMAP.md`. `ROADMAP.md` is the plan and its
  status: a commit that finishes, changes or adds a task updates its entry
  there.

## Changesets

Releases come from changesets: small Markdown files in `.changeset/` that
say what a change means for people using Lucent.

- **When.** A change under `packages/` needs one: every package there is
  bundled into `@lucent-lang/lucent`, the only one published, so the
  changeset names it whichever package the change touched. CI fails a PR
  that changes `packages/` without one. Changes users can't see (docs,
  tests, refactors that keep behavior) take the `no-changeset` label
  instead.
- **How.** `pnpm changeset` asks for the bump and a summary, and writes the
  file; commit it with the change.
- **Which bump.** Lucent is 0.x: patch for fixes, minor for features _and_
  for anything that breaks code that compiled before (say what breaks in
  the summary). Major is for 1.0; the Changeset check refuses it until then.
- **What to write.** One line for users, in the imperative: what changed and
  why it matters to them, not how the code did it. "Keep `instanceof`
  working after an app reinstalls Lucent", not "Store prototypes on the
  global object".
- **Release flow.** Merged changesets collect in a "Version packages" PR
  that the release workflow opens and keeps current: it bumps the version
  and writes `packages/lucent/CHANGELOG.md`, each entry linking its PR and
  author. Merging that PR publishes to npm with provenance, tags the
  release and creates the GitHub release, after `pnpm check`, the tests,
  the runtime tests and `smoke-install` pass.

## Docs

The website's docs follow [apps/website/CONTRIBUTING-DOCS.md](apps/website/CONTRIBUTING-DOCS.md):
the kinds of page, the writing rules and the glossary. `scripts/website.ts`
checks them, and CI runs it with `--check`:

- it regenerates what the site shows from the source: the CLI and
  diagnostics references, the `lucent:*` declarations, the examples, the
  C++ of samples, the search index;
- it compiles every `*.lucent.ts` sample;
- it checks internal links and anchors, each page's length budget, and its
  prose with Vale (`brew install vale`).

`docs/` is for contributors: [architecture](docs/architecture.md), the
language's [semantics](docs/semantics.md), [testing](docs/testing.md), and
proposals in [docs/design/](docs/design/). What users need lives on the
website.
