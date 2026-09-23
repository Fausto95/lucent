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

- [x] `lucent:core` served by the compiler; `@lucent-lang/core` compiles with
      warning LUCENT3008 (warnings are a new severity: they never fail a build,
      and the editor shows them as warnings). The package is gone; its JS
      helpers serve only the e2e harness.
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

- [ ] Device runs: both example apps' test screens on the iOS simulator and
      Android emulator (bare and Expo, Release).
- [ ] A fresh bare app and a fresh Expo app from the tarball + `npx lucent
      init` to a working module on both platforms.
- [ ] `npm deprecate` the six 0.0.3 packages (the user runs it).

Postponed:

- Two Lucent-using libraries in one app yielding one runtime: waits for the
  publishing phase of the improvement plan.

## Part B: the CLI

Not started.
