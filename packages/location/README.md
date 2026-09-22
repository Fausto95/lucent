# @lucent-lang/location

Gate C location package skeleton (roadmap P84). CI stubs deliver fake positions;
device GPS / fused providers remain a later pass.

## What works today

- `LocationPermission` string union and `requestPermission()` stub (`"granted"`)
- Owned `LocationProvider` with `updates` / `deliverFake` / `close`
- Borrowed `Position` values in `updates` (copy fields out before return)
- Updates callback contract: keep-latest `backpressure: "latest"`
- `lucent-overlay.json` ownership / executor / cancellation overlay
- Lucent source under `lucent/provider-updates.lucent.ts`
- Compile + adversarial tests in `test/library.test.ts`

## Device tests remaining (P84)

- Real CoreLocation / Fused Location, background policies, energy budgets
- Permission transitions and service-disabled recovery
- Host Expo / Nitro wiring

Pass criteria from P84 are **not** fully met until those paths land.
