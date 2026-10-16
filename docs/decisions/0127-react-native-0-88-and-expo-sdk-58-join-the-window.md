# 0127. React Native 0.88 and Expo SDK 58 join the window, and 0.85 and SDK 56 leave it

- **Date:** 2026-10-16
- **Status:** accepted

React Native 0.88.0 and Expo SDK 58, which pins it, are stable, so the
window moves as [0074](0074-a-window-of-stable-react-native-and-expo-releases.md)
says. It is React Native 0.86 to 0.88 and Expo SDK 57 and 58. React
Native 0.85 and SDK 56 leave it: SDK 57's 0.86.3 is now the oldest React
Native an SDK of the window ships
([0079](0079-react-native-0-85-is-in-the-window-and-no-release-needs-a-fallback.md)).

- **Templates.** `lucent create` starts apps on React Native 0.88.0 and
  SDK 58. The bare template's native projects are 0.88.0's template's,
  whose iOS app starts in a scene delegate; Lucent's forwards are in it,
  as `lucent init` writes them.
- **The prerelease lane.** It is 0.89's release candidates and SDK 59's
  preview, of which none is published on this date. The headers harness
  skips a lane with no candidate (a nightly is none). The example apps
  stay on 0.88's candidate and SDK 58's preview until 0.89's are out.
- **What holds.** 0.88.0 builds with the libraries 0079 names, at the
  same versions, and needs iOS 15.1, as its candidates did.

_Why:_ the window is the current and the previous stable releases, and a
library can't ship on a release that has left it. Moving the example apps
needs device runs, which wait for a candidate to move them to. _Changed:_
[T140](../tasks.md#t140), the templates' versions.
