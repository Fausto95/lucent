# 0117. A platform file exports what takes or gives platform objects for native code alone

- **Date:** 2026-10-15
- **Status:** accepted; extends
  [0116](0116-native-code-calls-a-modules-exports-through-generated-swift-and-kotlin.md)

A platform module's iOS or Android file may export a function its
declaration file doesn't declare when the function's parameters or result
name a platform object (`label(b: Build): string`, `echo(b: Build): Build`,
`count(bs: Build[])`). JavaScript never sees it: it is no export of the
module's JavaScript, and the declaration file can't name its types. Native
code calls it through its entry point, which passes the objects as
`lucent_value`s of kind `LUCENT_PLATFORM_OBJECT`: an `id` on iOS, a
`jobject` on Android. Lucent holds one it is given with a reference of its
own, and keeps one it gives until the caller is done, as it keeps strings.
Another undeclared export is still LUCENT3005.

_Why:_ native callers pass what only native code has (an Activity, a view,
a `Context`), which 0116 lets cross, but a platform object can't cross to
JavaScript (LUCENT2006), so an export taking one was refused. An
OS-made class is already the platform's alone
([0097](0097-exported-classes-extending-android-classes-are-os-made.md));
a function is the same case, and its types are the mark, so a forgotten
declaration of anything else still fails.
_Changed:_ [T114](../tasks.md#t114), `platforms.ts` (`nativeOnlyFunction`),
`emit/index.ts` and `emit/bindings.ts` (`ModuleExports.native`),
`emit/entries.ts`.
