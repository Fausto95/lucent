---
"@lucent-lang/lucent": minor
---

A Lucent function a worklet library carries into its runtime (a `react-native-worklets` UI or worker runtime) now runs there instead of reaching into React Native's runtime: the first call attaches a host to that runtime, torn down with it. A synchronous export runs on the calling thread under its module's lock, and on the main thread (the UI runtime) it enters as main-thread delegates do, so it never waits behind a JavaScript callback that waits for the main thread. The worklet runtime never becomes the runtime module work defaults to, and never keeps module state alive: after a reload its calls throw `AbortError` until React Native's next runtime is installed. An async export's promise settles through the scheduler the runtime's creator gives with `lucent::js::Host::attach(runtime, poster)`; without one, it rejects at once with `NotSupportedError`.
