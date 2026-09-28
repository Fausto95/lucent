---
"@lucent-lang/lucent": patch
---

End Lucent's work for a JavaScript runtime when it reloads: async calls that have not started are dropped, Lucent code awaiting a JavaScript promise or callback resumes with an `AbortError` instead of never, results the old runtime can no longer receive are released, and platform objects are released on the thread they require (the main thread for UIKit objects) whichever thread drops them. A second Lucent host for the same runtime no longer leaves JavaScript calls failing with "Lucent is not initialized for this runtime".
