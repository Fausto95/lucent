# Lucent

Ahead-of-time compiler: a constrained TypeScript subset in `*.lucent.ts` files
becomes Swift and Kotlin, exposed to React Native through Expo Modules or Nitro.
No JS runtime exists on the native side.

## Layering (one way, never reversed)

```
cli / expo / metro  →  host-expo / host-nitro  →  backend-swift / backend-kotlin  →  compiler  →  oxc-parser
                                ↘                          ↙
                                   codegen  (leaf, no deps)
```

- `packages/compiler` is pure: source text in, IR + diagnostics out. It imports
  nothing but `oxc-parser`, and only `src/parser/` may import it.
- Backends know the IR only. Hosts know backends and the target SDK. Integrations
  (cli, metro, expo plugin) know hosts.
- `packages/codegen` knows no IR and no target language. It holds the emission
  document tree, which owns indentation and brace balance, and `fillNative`.
- Definitions are data: type mappings, diagnostic codes, and templates live in
  lookup tables, not `switch` ladders.

## Emitting native code

- Hand-written Swift, Kotlin and build files live in each package's `native/`
  as real source, never as TypeScript string literals. Host-supplied fragments
  arrive through `{{token}}` placeholders. The compiler cannot read files, so
  `scripts/embed-native.ts` generates its embed; `pnpm verify` checks it is
  fresh.
- Generated code is built as a `Doc` and rendered via `@lucent-lang/codegen`
  (`block`, `indent`, `sections`, `render`, `fillNative`). Never hardcode an
  indent prefix, and never push an opening and closing brace as separate lines —
  use `block`, so nesting cannot fall out of step with the text.
- Do not assemble Swift/Kotlin with TypeScript template literals or string
  concatenation that invents braces or indentation — including verify harnesses
  under `scripts/`. Hand-written runners live in `scripts/native/` (or package
  `native/`) and are composed with `fillNative` + `Doc` helpers in
  `scripts/lib/`.
- Expressions are built as a `SwiftExpr` / `KotlinExpr` and printed.
  Parentheses come from the precedence table and Swift's `try` from an
  exhaustive effect walk; neither is written by hand at a call site.

## Working

- `pnpm install`, then `pnpm test`, `pnpm typecheck`, `pnpm verify` (also compiles
  generated Swift/Kotlin with `swiftc`/`kotlinc`). Vite+ (`vp`) provides tests, lint, format and packing; scripts run on tsx.
- Fixtures in `fixtures/` are the shared contract: `<name>.lucent.ts` with golden
  `<name>.ir.txt`, `<name>.swift`, `<name>.kt`, `<name>.diag.txt`.
- Tests are committed before the implementation they prove (red, then green).
- Conventional Commits, imperative mood, title ≤ 50 chars.
- `docs/language.md` changes in the same commit as the behaviour it describes.
