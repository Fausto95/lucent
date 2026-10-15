---
"@lucent-lang/lucent": minor
---

A component's iOS code may return a UIKit view controller, such as `AVPlayerViewController`. The host adds it as a child of the nearest view controller above the component, in the component's layout direction, and removes it when the component unmounts. Its style or flex sizes it, or its `preferredContentSize` when it has one, and it gets no safe area insets. A component returning a view on some paths and a view controller (or, on Android, a `Fragment`) on others fails with LUCENT3020.
