---
"@lucent-lang/lucent": minor
---

Keep a callback on an executor in a `const` to hand it to the platform more than once: `const listener = on(fixes, (fix) => …)`, or `on(executor, new Observer(…))` for an object, is one platform object wherever it goes, so `manager.removeUpdates(listener)` removes the listener `requestLocationUpdates` added. Each use passes it to an SDK call or property; calling it or giving it to Lucent code is `LUCENT1007`.
