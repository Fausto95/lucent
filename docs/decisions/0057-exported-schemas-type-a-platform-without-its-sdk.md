# 0057. Exported schemas type a platform without its SDK

- **Date:** 2026-10-08
- **Status:** accepted

`lucent sdk lock --schemas` writes `lucent-sdk.schemas/` beside the lock: the schemas the code's modules were read with, the modules their types name (names only on iOS, schemas on Android), each with the artifacts the lock records. Where a platform's SDK is not installed the provider serves that platform from the directory, so a Linux CI or a teammate without Xcode type-checks and generates iOS code; an installed SDK always wins, and a module the directory lacks is `LUCENT3004` with the fix. _Why:_ iOS branches were untyped on Linux (`lucent:ios/*` as an untyped wildcard), so errors in them surfaced only on a Mac. Shipping whole SDK schemas was rejected: UIKit's alone is megabytes, and the set the code uses is what a review sees change.
