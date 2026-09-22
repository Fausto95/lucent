# Fresh-install smoke checklist

Use this after a version bump or before tagging a release candidate (P89 / P90).
It complements [`docs/release.md`](../docs/release.md); it does not replace
device acceptance.

## Clean machine / clean checkout

- [ ] Clone the repo (or unpack a source archive) into a new directory
- [ ] Node ≥ 22.12 and `pnpm` available (`corepack enable` if needed)
- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm typecheck` and `pnpm test` succeed
- [ ] `pnpm verify` succeeds on a machine with `swiftc` / `kotlinc` (or note CI image)

## CLI from workspace

- [ ] `pnpm exec lucent --version` prints CLI + compiler versions
- [ ] `pnpm exec lucent doctor` runs without private env vars
- [ ] `pnpm exec lucent init` in a temp app dir scaffolds config + starter module
- [ ] `pnpm exec lucent build --host expo` (or nitro) produces a package under the
      documented out dir
- [ ] `pnpm exec lucent build --emit hir` writes `.lucent/ir/*.ir.txt` and
      `.lucent/ir/*.lucent.map.json`

## Package consume (pre-npm)

Until packages are on the registry, consume from the workspace:

- [ ] Example app (Expo or Nitro) resolves `@lucent-lang/*` via `workspace:*`
- [ ] Example builds after `lucent build`
- [ ] Document any manual native pod / gradle steps in the example README

## Publish dry-run (when cutting a candidate)

- [ ] `pnpm exec lucent pack` (or `pnpm -r pack --dry-run`) lists intended tarballs
- [ ] Each publishable package has `publishConfig.access` and a matching version
- [ ] Changelog / release notes name the previous good candidate for rollback
- [ ] Do **not** `npm publish` until P90 device evidence and matrix rows are attached

## Stop conditions

Abort the smoke if install requires undocumented secrets, if generated native
sources must be hand-edited, or if verify fails on the documented toolchain.
