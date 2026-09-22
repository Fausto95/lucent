# @lucent-lang/background

Gate C background-tasks package skeleton (roadmap P85).

## Durable vs in-process

| Kind                          | Survives JS teardown | Payload                         | Entry point           |
| ----------------------------- | -------------------- | ------------------------------- | --------------------- |
| Durable (`durable: true`)     | Yes (OS-scheduled)   | Serializable + `payloadVersion` | Statically registered |
| In-process (`durable: false`) | No                   | May be process-local            | Active scope only     |

An in-memory closure is **not** a durable job payload. Unsupported scheduling
options must surface as capability checks or diagnostics, not identical iOS /
Android claims.

## What works today

- Owned `BackgroundJobHandle` with `payloadVersion`, `cancel`, `close`
- Native stub records scheduled jobs; `scheduledCount()` for CI
- Lucent orchestration example under `lucent/schedule-job.lucent.ts`
- Compile tests in `test/library.test.ts`

## Device tests remaining (P85)

- OS job registration (BGTaskScheduler / WorkManager), expiration, retries
- Process-kill and upgrade payload migration tests
- Host Expo / Nitro wiring

Pass criteria from P85 are **not** fully met until those paths land.
