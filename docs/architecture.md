# Architecture

```
          app/src/*.lucent.ts
                  │  lucent build (packages/cli)
                  ▼
 ┌──────────────── packages/compiler ─────────────────┐
 │ program.ts   TypeScript program (strict +          │
 │              noUncheckedIndexedAccess)              │
 │ types.ts     TS types → Lucent types (structs by    │
 │              shape, unions, optionals, classes)     │
 │ emit/        functions, statements, expressions,    │
 │              builtins, classes, closures → C++      │
 │ emit/bindings.ts   JSI conversions, prototypes,     │
 │              module installers                      │
 │ native-package.ts  writes .lucent/native            │
 └─────────────────────────────────────────────────────┘
                  │
                  ▼
 .lucent/native/                      (autolinked by React Native)
 ├── cpp/lucent/        runtime (copied from packages/runtime/cpp/lucent)
 ├── cpp/rn/            LucentModule: the pure C++ TurboModule "Lucent"
 ├── cpp/generated/     lucent_app.h, m_<module>.cpp, lucent_bindings.cpp
 ├── ios/LucentRegistration.mm       +load → registerCxxModuleToGlobalModuleMap
 ├── android/CMakeLists.txt          OBJECT library linked into appmodules
 ├── android/include/lucentnative.h  stub Java-module provider for autolinking
 ├── LucentNative.podspec
 ├── react-native.config.js          pure C++ dependency (cxxModule* fields)
 └── js/<module>.js                  proxies Metro bundles instead of the .ts
```

## Compiler

The compiler builds a real TypeScript `Program` and never re-implements type
inference. Every expression's type, including the checker's narrowing at that
location (`if (x !== undefined)`, `switch (s.kind)`, `typeof`, `instanceof`),
comes from `checker.getTypeAtLocation`. The emitter lowers each expression to a
C++ expression plus its *representation* type, and inserts explicit
conversions where the checker's type differs: unwrapping an optional,
narrowing a union member, widening into a union, adapting a callback's arity.

Notable lowering choices:

* **Structs are deduplicated by shape.** `type Point = {x, y}`, an interface with
  the same fields, and an object literal `{ x: 1, y: 2 }` all share one C++ struct.
* **Class inheritance** maps to C++ inheritance: methods and accessors in a
  hierarchy are `virtual`, overrides are checked to keep the native
  signature, and `super(...)` runs the base's `construct()` and then the
  subclass's field initializers. A base-typed value converts to JavaScript
  as its most derived class, whose prototype's `__proto__` is the base's.
* **Interfaces implemented by classes** become abstract C++ bases (`I_Shape`)
  with pure-virtual methods and `get_`/`set_` accessors for properties.
  Implementing classes inherit them, fields get generated overrides, and
  values are `Ref<I_Shape>`. Because every implementer is known at compile
  time, the JS boundary converts an interface value by trying each
  implementing class in turn. Generic interfaces are class templates, and an
  interface that extends others inherits them `virtual`ly, so a class
  implementing both `A` and `B extends A` has a single `A`.
* **Integer inference** (`emit/integers.ts`): a local whose every write is
  a bitwise result (`|`, `^`, `>>>`, `Math.imul`, …) or an integer literal
  lives in an `int32_t`, `uint32_t` or `int64_t`, and a `for` counter stepped
  by an integer is an `int64_t`. Values are exact in both representations, so
  reads convert to `double` without changing results; expressions also carry
  their integer form, so chains of bitwise operations never round-trip through
  `double`. Increments and arithmetic writes keep a local a `double`, because
  `x + 1` does not wrap in JavaScript.
* **Closures** are C++ lambdas wrapped in `lucent::Fn`. A local captured by a
  closure *and* written after its declaration lives in a `lucent::Box`, so both
  sides see one variable (analysis in `emit/analysis.ts`).
* **Generators** are coroutines whose declared return type is
  `lucent::Iter<T>` (a `coroutine_traits` specialization supplies the
  promise). `iterator.return()` resumes a suspended generator so that its
  pending `co_yield` throws `lucent::GeneratorReturn`, which unwinds through
  the generated `finally` code; JS `catch` clauses rethrow it.
* **Coroutines** never reference lambda captures: an async arrow becomes a
  capture-less coroutine that receives its captures as parameters.
* **`try/finally`** uses completion codes: `return`, `break` and `continue` inside
  the protected block jump to the finally label and are replayed after it.
  Catch bodies run outside the C++ `catch` handler, because `co_await` is not
  allowed inside one.
* **Evaluation order**: when more than one argument or operand could have side
  effects, they are evaluated into temporaries left to right (GNU statement
  expressions, supported by clang and GCC).
* **`#line` directives** use the source's canonical absolute path, so compiler
  errors, debugger stepping and the DWARF line table (crash symbolication
  with the app's dSYM or unstripped `.so`) point at the `.lucent.ts` file.
  Errors created in Lucent code record the same `__FILE__`/`__LINE__` and
  enclosing function (`lucent::withSite`), and the JSI boundary puts that
  frame at the top of the JS error's `stack`.

## Runtime

`packages/runtime/cpp/lucent` is header-heavy C++20 with no dependencies
beyond the standard library, plus JSI for the boundary (`lucent/jsi`).

* `jsstring.h`: `lucent::String`, an immutable, shared, UTF-16 string with a
  Latin-1 fast path. When the handle is the only owner, `+=` appends in place,
  so building a string in a loop is linear.
* `number.h`: ECMAScript number semantics. `toString` produces the shortest
  round-trip digits; `toFixed` rounds on the exact binary value.
* `array.h`, `map.h`, `bytes.h`: shared containers with JS semantics.
* `async.h`, `scheduler.h`: `Promise<T>` as a coroutine type. Bodies start
  eagerly, and `await` always resumes from the microtask queue.
  One Lucent thread runs jobs and timers, and one recursive lock serializes all
  Lucent code.
* `jsi/host.h`: one `Host` per JS runtime. It owns every JSI reference Lucent
  holds (promise resolvers, callbacks, class prototypes, the identity cache).
  An anchor object on `global` invalidates it while the runtime tears down.
  Native code refers to JSI objects only by id and hops to the JS thread to use
  them.
* `regexp.h`: `RegExp` on QuickJS's `libregexp` (vendored, MIT, in
  `cpp/third_party/quickjs`), which matches Latin-1 and UTF-16 buffers
  directly; compiled patterns are cached by source and flags.
* `jsi/convert.h`: `Convert<T>` between JSI values and Lucent values. The
  compiler emits specializations for structs, classes and unions.
* `abort.h`: `AbortController` / `AbortSignal`. A signal from JavaScript is
  mirrored by a native signal stored as `NativeState` on the JS object; an
  `abort` listener on the JS signal aborts the mirror synchronously on the JS
  thread, under the Lucent lock, so native listeners run in the same turn as
  JavaScript's.

## React Native integration

`LucentModule` is a C++ TurboModule. Its `create(runtime, name)` returns the
exports object of the Lucent module `name`, built on first access.

* **iOS**: `LucentRegistration.mm` registers the module in React Native's
  global C++ TurboModule map from `+load`. No codegen and no app delegate changes.
* **Android**: the package is a *pure C++ dependency*. React Native's gradle
  plugin adds `android/CMakeLists.txt` to the app's `appmodules` build and
  generates `autolinking_cxxModuleProvider`, which instantiates `LucentModule`.

Both React Native CLI and Expo autolinking read the app's
`react-native.config.js`, whose `lucent-native` entry points at `.lucent/native`.

On the JavaScript side, each proxy calls
`loadModule(name, () => require("react-native").TurboModuleRegistry)`.
Resolving `react-native` from the app's own location avoids picking up a second
copy in monorepos.

## Editor diagnostics

`@lucent-lang/ts-plugin` is a TypeScript language-service plugin. tsserver
loads it with `require()` and its own `typescript`, which may be a different
version from the compiler's; the lowering matches on `ts.SyntaxKind`, so the
plugin never hands the editor's AST to the compiler. It `import()`s the
compiler (an ES module) asynchronously, refreshes diagnostics once loaded, and
calls `checkSources(files, readSource)` with the project's `*.lucent.ts` paths
and the editor's unsaved buffer text. The compiler builds its own program
(library declarations are parsed once per process) and returns diagnostics
with offsets and lengths. One check serves every file until a Lucent source
changes version. TypeScript errors are left to TypeScript.

## Tests

* `packages/runtime/test/run.sh`: runtime unit tests, including under
  ASan/UBSan.
* `packages/compiler/test/e2e/run.ts`: each case is compiled, built into a Hermes
  host (`packages/runtime/test/jsi/harness.cpp`), and run through real JSI. The
  same test script runs against the TypeScript source as plain JavaScript in
  Node, and the outputs must match line for line.
* `scripts/app-check.ts`: runs `lucent build` on an example app, builds the
  generated C++ into the Hermes host, bundles the app's test screen code with the
  app's own Metro config, and runs it. This is the whole device pipeline except
  the platform build systems.
