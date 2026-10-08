## What and why

<!-- What this changes for people using Lucent, and why. Link the issue or the ROADMAP.md task. -->

## How it was verified

<!-- The tests added or run (the e2e case for a language change), and what you couldn't run (no Xcode, no device). -->

## Checklist

- [ ] A changeset for `@lucent-lang/lucent` (`pnpm changeset`; under 0.x a breaking change is a minor), or the `no-changeset` label for docs and tests
- [ ] A language feature has an end-to-end case in `packages/compiler/test/e2e/cases/`, and `node scripts/sync-examples.ts` ran
- [ ] `ROADMAP.md`, `docs/` and the website updated with the behavior
- [ ] `pnpm check` passes
