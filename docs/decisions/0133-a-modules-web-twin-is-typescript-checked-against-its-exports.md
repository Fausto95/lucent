# 0133. A module's web twin is TypeScript the web bundle runs, checked against the module's exports

- **Date:** 2026-10-17
- **Status:** accepted

How [0077](0077-the-web-is-a-target-for-shared-modules.md)'s web target
works ([T144](../tasks.md#t144)).

- **Bundling.** For the `web` platform, Metro bundles each `*.lucent.ts`
  module as its JavaScript, in development and release bundles alike, as
  JavaScript dev mode does. `lucent:core` and `lucent:thread` are their
  JavaScript, and `PLATFORM` is `"web"`, which its type now includes.
- **Twins.** `m.web.lucent.ts` is the web twin of the module `m`, a shared
  module or a platform module alike. On web, Metro resolves an import of
  `m` to it. Native builds leave it out. A twin is plain TypeScript, not
  Lucent: it may use the DOM, `localStorage` and npm packages. Of Lucent's
  modules it imports `lucent:core`, `lucent:thread` and `lucent:platform`.
- **Checks.** `lucent build` type-checks each twin with the DOM's types
  against `m`'s exports. A twin missing an export, or giving it another
  type, is a diagnostic at the twin.
- **Platform code.** On web, a module without a twin fails its transform
  when it is a platform module, or imports a platform's modules
  (`lucent:ios/…`, `lucent:android/…`, `lucent:ext/…`, a toolkit). The
  error names the platform files or the import's line, and the twin to
  add.
- **Views.** A `.lucent.tsx` module bundled for web fails its transform:
  views are native.

_Why:_ the web bundle is where a module meets the web, so an app that
isn't on the web never hears of twins. Resolving to the twin, rather than
transforming the module into a require of it, keeps Metro's cache of each
file its own. A twin is the web's own code, so it is checked against the
module, not compiled by Lucent. _Limits:_ a module that branches on
`PLATFORM` around platform imports still needs a twin, and a twin can't
conform to a declaration's enum, which TypeScript compares by name.
