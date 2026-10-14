---
"@lucent-lang/lucent": patch
---

A Lucent class implementing an iOS protocol no longer has to implement the optional requirements of the protocols that protocol adopts: `class Downloads implements URLSessionDownloadDelegate` needs only `urlSession_downloadTask_didFinishDownloadingTo`, not URLSessionDelegate's `urlSession_didBecomeInvalidWithError` and the rest, which the declarations had made required.
