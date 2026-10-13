# 0086. Platform memory is adopted read-only unless asked, and NSData stays a copy

- **Date:** 2026-10-13
- **Status:** accepted

The design of [T108](../tasks.md#t108). A `NativeBuffer` may hold bytes
no one may write (`NativeBufferObject::adoptReadOnly`). They are read,
handed out as a `NativeHandle`, moved to a worker and copied as any
buffer's, but a write borrow throws `InvalidStateError`, from Lucent or
JavaScript, and so does `transferToArrayBuffer()`, since every
`ArrayBuffer` JavaScript gets is writable. A move keeps them read-only.
`adoptPixelBuffer(pixelBuffer, plane, access)` in `lucent:ios` and
`adoptHardwareBuffer(buffer, access)` in `lucent:android` adopt a frame's
plane uncopied, locked for the CPU until the bytes are released, then
unlocked and released once. `access` is `"read"` by default, which locks
it read-only and adopts it so, and `"readwrite"` locks it for writing and
lets it move into an `ArrayBuffer`. A HardwareBuffer must have one layer
and one plane, and have been made for the CPU uses asked. An `NSData` is
not adopted: Swift's `Data` and `NSData` cross into Lucent as `Uint8Array`
copies, so Lucent code never holds one, and its bytes may be shared or
mapped read-only while a `Uint8Array` is writable. A file's or a
response's bytes reach JavaScript with that one copy, then move. _Why:_
writing a pixel buffer locked for reading, or mapped file bytes, corrupts
or crashes, and a copy made behind the caller's back would hide the cost
the stats count; asking for `"readwrite"` says the frame is the caller's
to change. Nitro's and Expo's `Data` conversions copy too. _Changed:_
[T108](../tasks.md#t108)'s `NSData` item, which this replaces.
