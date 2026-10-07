# 0038. Metro bundles each proxy as a module of its own

- **Date:** 2026-10-06
- **Status:** accepted

The
Metro transformer turns a `*.lucent.ts` file into a require of its proxy
in the native package instead of inlining the proxy's text. _Why:_ Metro
computes a transformer's cache key once per process and re-transforms only
files of its graph that change, so an inlined proxy stayed stale after a
build rewrote it, and a module bundled before its first build kept its
"not compiled" stub until a restart (sometimes after one too, from the
persistent cache). _Changed:_ a build needs a reload, not a Metro restart;
a module with no proxy fails the bundle instead of bundling a throw; the
cache key holds the native package's location and module names, not the
whole manifest. `withLucent` adds the app's `node_modules` to
`resolver.nodeModulesPaths`: a proxy's bare requires now resolve from the
proxy's directory, which a `LUCENT_OUT` outside the app never connects to
the app's packages.
