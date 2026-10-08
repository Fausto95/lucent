# 0046. Ports keep their APIs; views share state the main thread owns

- **Date:** 2026-10-07
- **Status:** accepted

To port mmkv, expo-file-system, expo-image and expo-video (TA35, now
[TA36](../tasks.md#ta36)),
Lucent gained rest parameters, `ArrayBuffer` and main-thread state. A
module variable only main-thread code uses (components, `main()`
callbacks) is the main thread's: views use it without the Lucent lock.
Taking the lock in views was rejected: the main context never waits
behind module code. Class instances as view props were rejected too:
they would need handles with lifetimes across Fabric, while Expo's own
`VideoView` passes the player's id, which a port can do.
