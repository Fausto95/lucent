# @lucent-lang/bluetooth

Gate C Bluetooth package skeleton (roadmap P82). Feature orchestration belongs
in Lucent; this package ships library bindings and FakeSdk-style CI stubs with
fake peripherals. Physical BLE adapters are not required for the CI pass.

## What works today

- Owned `BluetoothScanner` with `start` / `stop` / `connect` / `close`
- Owned `BluetoothConnection` with `read` / `write` / `notifications` / `close`
- Binary payloads as `Uint8Array`
- Notifications callback contract: `retention: "subscription"`,
  `executor: "worker"`, `errors: "notify"`, `backpressure: "block"` (package
  policy buffer(n=32); runtime queue still stubbed — deliveries are synchronous)
- `deliverNotification` for harness delivery without a device
- Lucent source under `lucent/scan-connect.lucent.ts`
- Compile tests in `test/library.test.ts`

## Device tests remaining (P82)

- Real CoreBluetooth / Android BLE scan and GATT
- Permission, disconnect races, reconnection, and bounded queues
- Host Expo / Nitro wiring

Pass criteria from P82 are **not** fully met until those device paths land.
