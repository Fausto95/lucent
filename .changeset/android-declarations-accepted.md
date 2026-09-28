---
"@lucent-lang/lucent": patch
---

Android declarations TypeScript accepts: an `Activity` goes where a `Context` is taken (an override keeps the non-null result of the method it overrides, whatever package declares it), and abstract SDK classes such as `BiometricPrompt.AuthenticationCallback` keep their constructors, protected ones as protected, so Lucent classes extend them. Every class extends `java.lang.Object`, imports named like a local type are aliased, and a few members TypeScript cannot relate to what they override are left out with their reason (an `Object` result narrowed to an interface or a type variable, `EditText.getText()` under `TextView`'s string, `Stack.empty()` beside `isEmpty()`). A class whose superclass and interface give one property two ways (`ViewGroup`'s `layoutDirection`, typed by `View`'s constants and as a number by `ViewParent`) declares the superclass's, the one it calls. The Android declaration audit drops from 81 errors to none.
