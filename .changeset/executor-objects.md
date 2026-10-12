---
"@lucent-lang/lucent": minor
---

Put a delegate or a listener on an executor where you make it, as in `parser.delegate = on(frames, new Collector(out))`: the platform's calls of its methods run on the executor, never behind module code. Its class is checked to keep to itself: made only in `on()`, not exported, using `this` only for its own members, and given only constants, channels and executors.
