# 0112. An iOS class's properties are accessors, which a Lucent subclass's accessors override

- **Date:** 2026-10-15
- **Status:** accepted

The declarations of an iOS class (Objective-C or Swift, not a protocol)
declare its instance properties as accessors: `get title(): string | null;`
with `set title(value: string | null);` unless the property is read-only.
A Lucent class extending an Objective-C class overrides a property with a
get accessor, a set accessor or both. Its generated subclass's getter and
setter run them while the platform waits, as a method override runs, and
before `super(…)` returns they are the base's. `super.name` reads the
base's getter and `super.name = v` writes the base's setter, through the
subclass's `lucentSuper_` methods, where the class overrides them; else
the property on the object. A set accessor for a read-only property, and
a Swift or C property, are refused (`LUCENT1005`).

A getter alone keeps the base's setter, as in Objective-C: JavaScript's
class would have none, but TypeScript makes the property read-only through
the subclass's type, so Lucent code doesn't write it there.

_Why:_ UIKit asks a subclass for `intrinsicContentSize`,
`preferredStatusBarStyle`, `canBecomeFirstResponder` and the like, which
are properties. TypeScript refuses an accessor overriding a property
(TS2611), so the base must declare accessors. The compiler already reads
an SDK property's accessors as the property (`isSdkPropertyDecl`), so
every use of one stays as it was.
_Changed:_ [T112](../tasks.md#t112), `sdk/dts.ts`, codegen's `ts/print.ts`
(`accessor`), `emit/objc-subclass.ts`, `emit/native.ts`, `emit/builtins.ts`.
