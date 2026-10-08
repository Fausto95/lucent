# 0063. Platform members, not platform classes

- **Date:** 2026-10-08
- **Status:** accepted

A private member (`private` or `#`) of an exported class, or of a class that uses both platforms, belongs to the platform whose code it uses outside a branch, and each build compiles its own platform's members only; the class stays shared, so JavaScript constructs it and calls its methods on both platforms, and an SDK object lives in a field instead of a module-level `Map` from ids. Public members, constructors and parameter properties stay shared code, since JavaScript and other classes see them (an interface or override dropped on one platform would not conform). A non-exported class whose platform code is all one platform's still belongs to that platform whole, so code that compiled before keeps its meaning. Class instances as view props stay refused, as on 2026-10-07 ([TA36](../tasks.md#ta36)): a view's setup and handlers run on the main thread without the Lucent lock, while an instance's fields belong to Lucent code, so a view calling its methods would race module code; a component takes the instance's id, as Expo's `VideoView` does. _Changed:_ [TA37](../tasks.md#ta37).
