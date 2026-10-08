# 0066. EventEmitter, typed like Expo's

- **Date:** 2026-10-08
- **Status:** accepted

`lucent:core` has `EventEmitter<Events>`, where `Events` maps each name to its listener's signature (`{ change: (value: number) => void }`), as Expo's `EventEmitter` does, rather than Node's tuples. JavaScript gets the same object each time, with `addListener` (returning `{ remove() }`), `emit`, `listenerCount` and `removeAllListeners`; its listeners are JS callbacks that belong to their runtime, so a reload removes them and `listenerCount` falls with them, which lets a module stop an SDK listener nobody hears. In Lucent an event's name must be a literal, so the native emitter indexes events statically; JavaScript's names are checked against the type. `subscribe` now resolves when its signal aborts: aborting is how a caller ends a stream, not a failure. _Changed:_ [TA37](../tasks.md#ta37).
