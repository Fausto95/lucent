# Lucent

Ahead-of-time compiler: a constrained TypeScript subset in `*.lucent.ts` files
becomes Swift and Kotlin, exposed to React Native through Expo Modules or Nitro.
No JS runtime exists on the native side.

## Layering (one way, never reversed)

```
cli / expo / metro  →  host-expo / host-nitro  →  backend-swift / backend-kotlin  →  compiler  →  oxc-parser
```

- `packages/compiler` is pure: source text in, IR + diagnostics out. It imports
  nothing but `oxc-parser`, and only `src/parser/` may import it.
- Backends know the IR only. Hosts know backends and the target SDK. Integrations
  (cli, metro, expo plugin) know hosts.
- Definitions are data: type mappings, diagnostic codes, and templates live in
  lookup tables, not `switch` ladders.

## Working

- `bun install`, `bun test`, `bun run typecheck`, `bun run verify` (also compiles
  generated Swift/Kotlin with `swiftc`/`kotlinc`).
- Fixtures in `fixtures/` are the shared contract: `<name>.lucent.ts` with golden
  `<name>.ir.txt`, `<name>.swift`, `<name>.kt`, `<name>.diag.txt`.
- Tests are committed before the implementation they prove (red, then green).
- Conventional Commits, imperative mood, title ≤ 50 chars.
- `docs/language.md` changes in the same commit as the behaviour it describes.
