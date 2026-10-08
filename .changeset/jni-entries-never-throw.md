---
"@lucent-lang/lucent": patch
---

On Android, an error in Lucent code that Java calls (a view's update, measure, layout or command, a Flex's measure, an interface method Lucent implements) is reported instead of unwinding into the JVM, which aborted the app. A Lucent interface method returning a primitive (`int`, `boolean`) that throws now gives Java its zero value rather than a `NullPointerException` hiding the error, and reading a Java exception as a Lucent error no longer leaks JNI local references.
