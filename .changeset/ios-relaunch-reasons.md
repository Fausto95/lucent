---
"@lucent-lang/lucent": minor
---

`onAppEvent("relaunched", (reason, details) => …)` from `lucent:ios` tells a module why iOS launched the app: `"location"` or `"bluetoothCentrals"` and `"bluetoothPeripherals"` for a background relaunch, with the Bluetooth managers' restoration identifiers, or `"notification"` with the `userInfo` of the notification the person opened it from. The reasons wait for the first listener, as a launch URL does.
