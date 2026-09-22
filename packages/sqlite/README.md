# @lucent-lang/sqlite

Gate C SQLite package skeleton (roadmap P83). CI stubs hold an in-memory map;
real SQLite engines remain a later native pass.

## What works today

- Owned `SQLiteDatabase` with `open` (constructor path) / `execute` / `query` /
  `transaction` / `close`
- Borrowed `SQLiteTransaction` scoped to the transaction body (`ownership:
"external"`); must not escape the callback. Nested transactions unsupported.
- Sync execute/query in this scaffold (native closures + borrowed tx cannot be
  async); `query` returns a row count. Typed row records remain forthcoming.
- Lucent source under `lucent/transaction.lucent.ts`
- Compile tests in `test/library.test.ts`

## Device tests remaining (P83)

- Real SQLite / SQLCipher, constraint errors, cancellation/commit races
- Prepared statements, cursors, and 64-bit integer fidelity
- Host Expo / Nitro wiring

Pass criteria from P83 are **not** fully met until those paths land.
