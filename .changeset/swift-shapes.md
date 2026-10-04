---
"@lucent-lang/lucent": patch
---

Bind more of what Swift declares on iOS: tuples (as TypeScript tuples, labels as element names), closures passed to or returned by Swift (as Lucent functions, through Objective-C blocks), Objective-C factory initializers Swift imports as `init` (`+widgetWithLabel:` as `new Widget(label)`), and C functions Swift imports as members of CoreFoundation-style handles (`cgImage.width`, `cgImage.cropping(rect)`). `new` of a class whose initializers come from a module no file imports now says to import that module.
