# One package and a better CLI: status

Tracks `lucent-cli-and-package-plan.md` (Part A: one package; Part B: the
CLI). Updated with each commit.

Decisions (the plan's open questions):

- Terminal UI: Ink everywhere (also for `init`), loaded lazily; picocolors for
  plain output.
- `lucent dev` runs in its own terminal; `withLucent` only prints compact
  build lines in Metro's output and never takes over Metro's keys.
- The old packages (`core`, `runtime`, `cli`, `metro`, `expo`, `compiler`, on
  npm at 0.0.3) get no re-export release, only `npm deprecate`.

## Part A: one package, `@lucent-lang/lucent`

Done:

- [x] `lucent:core` served by the compiler; the `@lucent-lang/core` package
      is gone, and its old specifier is an error like any unknown module (no
      deprecation period). Its JS helpers serve only the e2e harness.
- [x] Every Lucent source in the repository imports `lucent:core`.
- [x] The JS loader is generated into `.lucent/native/js/_lucent/runtime.js`;
      proxies require it relatively, and the Metro transformer rebases that
      onto the `.lucent.ts` file. app-check passes for both apps, and their
      bundles hold only the generated loader.
- [x] `packages/lucent` holds the CLI (`src/cli`), `metro/`, `app.plugin.js`
      and `ts-plugin/`; the cli, metro, expo and ts-plugin packages are gone.
      Both apps depend on `@lucent-lang/lucent` alone (`workspace:*`).
- [x] Publishing bundles the CLI and compiler into `dist/` (esbuild) and
      copies `lib/` and `runtime/`; the compiler finds the runtime inside the
      package. Compiler, bindgen and runtime are private. `release.yml`
      publishes `@lucent-lang/lucent` only.
- [x] `smoke-install.ts` installs the tarball alone: nothing else from
      `@lucent-lang` in `node_modules`, no `@lucent-lang/runtime|core` under
      `.lucent/`, Metro and Expo entries load, tsserver loads
      `@lucent-lang/lucent/ts-plugin`.
- [x] `lucent init` and `lucent build` map `"lucent:*"` in the app's
      tsconfig paths (JSONC-preserving edit).
- [x] Docs: README install section, website getting-started (bare, Expo),
      references, `docs/architecture.md`, `AGENTS.md`.
- [x] Device runs, Release (2026-09-24): bare iOS 21/21 tests + 23/23 SDK,
      bare Android 21/21 + 23/23, Expo iOS 21/21 + 36/36, Expo Android
      21/21 + 36/36. Expo's plugin ran `lucent build` from the new package
      during `expo prebuild --clean`. The emulator's location cases need fixes
      sent to its mock GPS provider (`cmd location providers
      set-test-provider-location gps …`).
- [x] Tests tab failures after switching tabs: three e2e cases printed module
      state, which persists across runs as in JavaScript. They now print what
      a run changes, and the e2e reference run executes every case twice.

Differences from the plan:

- The loader is `js/_lucent/runtime.js`, not `js/runtime.js`: proxies are
  `js/<module>.js`, so an app module named `runtime` would clash; no module
  name can map under `_lucent/` (npm package names cannot start with `_`).
- `@lucent-lang/sdk-ios` / `sdk-android` are removed, not published: nothing
  filled them for a release, they were never on npm, and without a local SDK
  Lucent already types that platform's modules as untyped and skips building
  it.
- The editor plugin is `ts-plugin/index.js` (not `.cjs`): tsserver resolves
  plugin names without `exports`. So the package root is CommonJS (Expo also
  `require()`s `app.plugin.js`); `src/` and `dist/` are ES module scopes.

Left:

- [ ] A fresh bare app and a fresh Expo app from the tarball + `npx lucent
      init` to a working module on both platforms.
- [x] `npm deprecate` the six 0.0.3 packages (the user runs it).

Postponed:

- Two Lucent-using libraries in one app yielding one runtime: waits for the
  publishing phase of the improvement plan.

## Part B: the CLI

Done:

- [x] UI foundation: a command table drives parsing, help and (later) the
      docs; commands load lazily, so `--help`, `--version` and a bare
      `lucent` load neither TypeScript, the compiler nor Ink (bundled
      `--help`: 30-50 ms). Terminal detection (NO_COLOR, FORCE_COLOR, CI,
      TERM=dumb, non-TTY, OSC 8 links), theme tokens with ASCII fallbacks,
      durations, tables, code frames (snapshots with and without colour, 80
      columns), `--json` plumbing, a crash handler (message, log path, issue
      link).
- [x] Diagnostics data: every code has a title, summary, explanation, fix
      and wrong/right examples (`packages/compiler/src/codes.ts`), checked
      against the compiler by a test that also fails for a code without one.
      Diagnostics carry `fix` and `docs`; the editor plugin shows them; the
      website's diagnostics page is generated from the same data.

- [x] `build` and `check`: steps with timings (live with Ink on a TTY, one
      line each elsewhere), modules with their platforms, what to do next;
      problems as code frames with fix and `lucent explain`; `--json`
      validated against `packages/lucent/schemas/*.schema.json`. A passing
      check is remembered under the build's inputs key: the example app's
      warm check takes 0.3 s (1.6 s after an edit).

Left:

- [ ] `doctor`
- [ ] `init` (Ink, diffs, `--yes`)
- [ ] `dev` (Ink dashboard), replacing `build --watch`; `withLucent` output
- [ ] `new module`, `explain`, `clean`, `--version` with SDKs
- [ ] `sdk search / show / prefetch`; `coverage` and `diff`
- [ ] `bench`
- [ ] Docs: CLI reference generated from the command table; README recording
