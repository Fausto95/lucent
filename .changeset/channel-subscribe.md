---
"@lucent-lang/lucent": minor
---

Add `Channel.subscribe(onValue)`. It calls `onValue` with each value as it comes, one at a time, on the context that subscribed. The next value is received once `onValue` returns, so the channel's policy still decides what waits. The subscription ends when the channel is closed and drained, or when you call `remove()` on what `subscribe` returns; values sent after that wait for the next receive. What `onValue` throws is reported, and the next value comes.
