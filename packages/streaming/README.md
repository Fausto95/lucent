# @lucent-lang/streaming

Gate C streaming package skeleton (roadmap P86). Explicit ownership and
backpressure live in contracts; CI stubs bound prefetch capacity.

## What works today

- Owned `FileChunkSource` with `capacity` (default package policy 4) and
  `readChunk()` returning owned `Uint8Array` buffers
- Owned `FileWriteSink` with `write` (borrowed chunk for await duration),
  `flush`, `close`
- `transformChunk` produces a new owned buffer from a borrowed input
- Lucent pipeline under `lucent/pipeline.lucent.ts`
- Compile tests in `test/library.test.ts`

## Device tests remaining (P86)

- Real file / network producers, unpausable sensor sources, soak tests
- Fan-in / fan-out ownership and measured throughput budgets
- Host Expo / Nitro wiring

Pass criteria from P86 are **not** fully met until those paths land.
