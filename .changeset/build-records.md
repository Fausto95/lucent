---
"@lucent-lang/lucent": patch
---

Record each build's steps in `.lucent/build-record.json`: what every step read and wrote, with content hashes, whether it ran, was cached or failed, and what the app needs next, so a slow or surprising build can be inspected afterwards.
