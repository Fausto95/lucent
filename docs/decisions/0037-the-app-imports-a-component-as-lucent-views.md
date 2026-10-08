# 0037. The app imports a component as `lucent:views/<module>`

- **Date:** 2026-10-06
- **Status:** accepted

TypeScript reads the React declarations `lucent build` writes
(`types/views/<module>.d.ts`) through the `lucent:*` path `lucent init`
already writes, and Metro's resolver (`withLucent`) maps the name to a
generated module that requires the component's own, so both imports are
one module and React Native registers the view once. _Why:_ TypeScript
resolves `./x.lucent` to the source before any `paths`, `rootDirs` or
ambient module, so no file under `.lucent` can type it; a declaration
beside the source would also capture the platform files' own imports of
it, and an editor plugin leaves `tsc` failing. Resolving the name to the
generated proxy would load it twice, and React Native refuses a view
registered twice. _Changed:_ C-VIEW v2.4, `lucent new view`'s import,
architecture.md, views.md.
