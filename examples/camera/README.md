# Camera processor acceptance fixture

`luminance.lucent.ts` is compiled to Swift and Kotlin. It computes mean Y-plane
luminance using the SDK-provided width, height, row stride and pixel stride.
The frame is borrowed for the duration of the native callback.

Run `node --import tsx scripts/verify-camera-frames.ts` from the repository root.
The harness generates a delegate through the public SDK generator, supplies a
synthetic SDK frame type and its bindings, and compiles the processor with the
normal compiler. Both native executables check known padded/interleaved planes,
1,000 valid/malformed frame pairs, closed-frame rejection, and zero open frames.

This fixture proves compiled processing and borrowed callback delivery. It does
not provide camera permissions, native preview, platform camera sessions,
backpressure, orientation handling, view lifecycle, or physical-device evidence.
Those remain tracked under M8 in [ROADMAP.md](../../ROADMAP.md).
