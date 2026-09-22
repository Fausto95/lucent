# Release engineering

Roadmap **P89** — operational readiness for a clean checkout and documented
toolchain. Use this checklist when cutting a release candidate.

## Required assets

- [ ] **Versioned language semantics** — [`docs/semantics.md`](semantics.md) is
      tagged with a version and matches the candidate's conformance fixtures.
- [ ] **Compatibility matrix** — [`docs/conformance-matrix.md`](conformance-matrix.md)
      lists supported compiler / runtime / host / package combinations with
      evidence links.
- [ ] **Lockfile** — root `pnpm-lock.yaml` (and any package-native lockfiles) are
      committed; CI installs with `--frozen-lockfile`.
- [ ] **Migration notes** — placeholder: [`docs/migration.md`](migration.md)
      (create or update when a breaking syntax, ownership, manifest, or ABI
      change ships).
- [ ] **Troubleshooting** — mapped native errors, permissions, dependency
      conflicts, and platform limitations documented for each published package
      (camera README, `lucent doctor`, getting-started).
- [ ] **Sanitized logs policy** — diagnostics and logs must not expose
      application secrets or sensitive camera, location, database, or Bluetooth
      payloads. Prefer codes, paths, and redacted summaries over raw buffers.
- [ ] **Security defect policy** — compiler/runtime memory-safety and contract
      defects: report via GitHub security advisory or private channel; fix or
      document as release-blocking; do not ship known UAF / double-cleanup /
      data-race paths on supported configurations.
- [ ] **Rollback / pinning** — document how to pin `@lucent-lang/*` versions,
      revert a bad package, and rebuild from a known lockfile. Changelog entry
      names the previous good candidate.

## Also required (P89)

- [ ] SDK / overlay schemas, host ABI, and runtime compatibility policy versioned
- [ ] Published compiler / runtime / package versions match the matrix
- [ ] Deterministic generated-source checks (`pnpm verify`, embed freshness)
- [ ] Reproducible package generation, install, upgrade, and clean-build smoke
      tests on Expo and Nitro examples
- [ ] Native dependency provenance, licenses, and required platform config per
      package
- [ ] Release checklist, changelog, known limitations

## Publishing packages

Packages are not on npm yet. Use the workspace until the first candidate:

1. `pnpm exec lucent pack` — lists non-private packages with `publishConfig`
2. `pnpm -r pack --dry-run` — inspect tarball contents
3. Complete [`scripts/smoke-fresh-install.md`](../scripts/smoke-fresh-install.md)
4. Attach Gate / P90 evidence ([`release-evidence.md`](release-evidence.md),
   [`P90-checklist.md`](P90-checklist.md))
5. Only then: `pnpm publish -r --access public` from the release commit

Do not publish private stub packages (`@lucent-lang/bench`, examples).

## Exit criterion

A release candidate can be installed, built, exercised, upgraded, and diagnosed
from published instructions without private setup steps or manual edits to
generated code.

See also: [`P90-checklist.md`](P90-checklist.md), [`release-evidence.md`](release-evidence.md),
[`scripts/smoke-fresh-install.md`](../scripts/smoke-fresh-install.md).
