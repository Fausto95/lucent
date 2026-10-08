# 0003. CLI and package

- **Date:** 2026-09-24
- **Status:** accepted

One published package,
`@lucent-lang/lucent`. The terminal UI uses Ink, loaded lazily; `lucent
dev` runs in its own terminal while `withLucent` prints compact lines in
Metro's; the six old packages are only deprecated. _Why:_ one install,
fast `--help`, and no takeover of Metro's keys.
