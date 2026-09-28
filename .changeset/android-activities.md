---
"@lucent-lang/lucent": minor
---

Give Android code the app's Activities. `lucent:android` adds `currentActivity()` (the Activity in front, or null; Lucent holds Activities weakly), `startActivityForResult(intent, signal?)` and `requestPermissions(permissions, signal?)` (promises settled once with the answer; aborting forgets the request, and a late answer is dropped), and `onActivityEvent(event, handler)` for the Activities' lifecycle and new intents. Requests go through a translucent Activity of Lucent's, so they work with any app Activity and survive it being recreated meanwhile. The native package's manifest declares it and a provider that starts tracking Activities with the process. Package manifest components may now set an activity's `theme` and `configChanges`.
