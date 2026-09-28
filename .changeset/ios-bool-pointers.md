---
"@lucent-lang/lucent": patch
---

`BOOL *` parameters are bound: in calls as an `Out<boolean>`, and where a block or protocol method receives one (`stop` in enumeration blocks such as `calendar.enumerateDates(…, (date, exact, stop) => { stop.value = true; })`), as an `Out` whose value goes back to the platform when the function returns. A class whose only initializer a protocol synthesizes keeps `new C()` (`new NSDateComponents()`).
