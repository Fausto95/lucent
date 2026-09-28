# Architecture

```
          app/src/*.lucent.ts
                  │  lucent build (packages/lucent)
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
 └──────────────────────────┬──────────────────────────┘
                            │ syntax trees
 ┌──────── packages/codegen ┴──────────────────────────┐
 │ cpp/ java/ kotlin/ ts/ xml/   one tree and          │
 │                               printer per language  │
 └─────────────────────────────────────────────────────┘
                  │
                  ▼
 .lucent/native/                      (autolinked by React Native)
 ├── cpp/lucent/        runtime (copied from packages/runtime/cpp/lucent)
 ├── cpp/rn/            LucentModule: the pure C++ TurboModule "Lucent";
 │                      LucentViews.h, what generated components share;
 │                      LucentViewRequests (commands' answers), LucentViewValues
 │                      (values between React's side and setup's); the hosts:
 │                      LucentComponentView (iOS), LucentViewsAndroid (Android)
 ├── cpp/generated/     lucent_app.h, m_<module>.cpp, lucent_bindings.cpp,
 │                      lucent_identity.cpp (what the program was built from),
 │                      views/ (components' Fabric sources, LUCENT_VIEWS=fabric)
 ├── ios/LucentRegistration.mm       +load → registerCxxModuleToGlobalModuleMap
 ├── android/CMakeLists.txt          OBJECT library linked into appmodules
 ├── android/include/…/ComponentDescriptors.h  components' descriptors, for autolinking
 ├── android/packages.cmake          Lucent packages' C/C++ sources, when any
 ├── android/include/lucentnative.h  stub Java-module provider for autolinking
 ├── LucentNative.podspec
 ├── resolved.json                   Lucent packages' lucent.json, merged, with provenance
 ├── packages/<package>/             the native files each Lucent package lists
 ├── react-native.config.js          pure C++ dependency (cxxModule* fields)
 ├── types/                          lucent:core and SDK declarations (tsconfig paths)
 └── js/<module>.js                  proxies Metro bundles instead of the .ts,
     js/_lucent/runtime.js           and the loader they require,
     js/_lucent/views.js             and the views runtime components' exports use
```

## Compiler

The compiler builds a real TypeScript `Program` and never re-implements type
inference. Every expression's type, including the checker's narrowing at that
location (`if (x !== undefined)`, `switch (s.kind)`, `typeof`, `instanceof`),
comes from `checker.getTypeAtLocation`. The emitter lowers each expression to a
C++ expression plus its _representation_ type, and inserts explicit
conversions where the checker's type differs: unwrapping an optional,
narrowing a union member, widening into a union, adapting a callback's arity.

Emitters build syntax trees, not text: `packages/codegen` (private, bundled
into the CLI) holds a tree, builders and a printer for each language Lucent
writes. C++ and Objective-C++ (`cpp`, which also holds the Objective-C
subclasses of iOS classes Lucent classes extend), the Java subclasses of
SDK classes (`java`), the Kotlin shims the Android glue calls for what JNI cannot call
as Kotlin declares it (`kotlin`), SDK declarations and module proxies
(`ts`), and the library manifest (`xml`). The printers add the parentheses
precedence and associativity need, so an emitter composes `cpp.binary(a, "+", b)` without
thinking about what `a` is. The C++ printer also parenthesizes the mixes clang's `-Wparentheses`
warns about. A tree used as a string throws, rather than printing
`[object Object]` into the output.

Notable lowering choices:

- **Structs are deduplicated by shape.** `type Point = {x, y}`, an interface with
  the same fields, and an object literal `{ x: 1, y: 2 }` all share one C++ struct.
- **Class inheritance** maps to C++ inheritance: methods and accessors in a
  hierarchy are `virtual`, overrides are checked to keep the native
  signature, and `super(...)` runs the base's `construct()` and then the
  subclass's field initializers. A base-typed value converts to JavaScript
  as its most derived class, whose prototype's `__proto__` is the base's.
- **Interfaces implemented by classes** become abstract C++ bases (`I_Shape`)
  with pure-virtual methods and `get_`/`set_` accessors for properties.
  Implementing classes inherit them, fields get generated overrides, and
  values are `Ref<I_Shape>`. Because every implementer is known at compile
  time, the JS boundary converts an interface value by trying each
  implementing class in turn. Generic interfaces are class templates, and an
  interface that extends others inherits them `virtual`ly, so a class
  implementing both `A` and `B extends A` has a single `A`.
- **Integer inference** (`emit/integers.ts`): a local whose every write is
  a bitwise result (`|`, `^`, `>>>`, `Math.imul`, …) or an integer literal
  lives in an `int32_t`, `uint32_t` or `int64_t`, and a `for` counter stepped
  by an integer is an `int64_t`. Values are exact in both representations, so
  reads convert to `double` without changing results; expressions also carry
  their integer form, so chains of bitwise operations never round-trip through
  `double`. Increments and arithmetic writes keep a local a `double`, because
  `x + 1` does not wrap in JavaScript.
- **Closures** are C++ lambdas wrapped in `lucent::Fn`. A local captured by a
  closure _and_ written after its declaration lives in a `lucent::Box`, so both
  sides see one variable (analysis in `analysis/scopes.ts`).
- **Generators** are coroutines whose declared return type is
  `lucent::Iter<T>` (a `coroutine_traits` specialization supplies the
  promise). `iterator.return()` resumes a suspended generator so that its
  pending `co_yield` throws `lucent::GeneratorReturn`, which unwinds through
  the generated `finally` code; JS `catch` clauses rethrow it.
- **Coroutines** never reference lambda captures: an async arrow becomes a
  capture-less coroutine that receives its captures as parameters.
- **`try/finally`** uses completion codes: `return`, `break` and `continue` inside
  the protected block jump to the finally label and are replayed after it.
  Catch bodies run outside the C++ `catch` handler, because `co_await` is not
  allowed inside one.
- **Evaluation order**: when more than one argument or operand could have side
  effects, they are evaluated into temporaries left to right (GNU statement
  expressions, supported by clang and GCC).
- **Awaits around SDK calls**: the glue of an SDK call, read or construction
  runs in C++ lambdas, which cannot be coroutines, so a receiver or argument
  that awaits (`(await file()).getName()`) is evaluated into a temporary
  first, with the operands before it.
- **`#line` directives** use the source's canonical absolute path, so compiler
  errors, debugger stepping and the DWARF line table (crash symbolication
  with the app's dSYM or unstripped `.so`) point at the `.lucent.ts` file.
  Errors created in Lucent code record the same `__FILE__`/`__LINE__` and
  enclosing function (`lucent::withSite`), and the JSI boundary puts that
  frame at the top of the JS error's `stack`.
- **Names keep their spelling** in C++ (`cppIdent` escapes only C++ keywords
  and the glue's own names), so a debugger shows them as written. The C
  library and the SDK headers define macros under ordinary names (`HUGE`,
  `DOMAIN`, `pascal`, `si_value`), different on each platform, so no list
  can avoid them: each generated file undefines, after its includes, every
  name the program declares that it spells (`#pragma push_macro`, `#undef`)
  and restores them at its end (`emit/macros.ts`).
- **Trace sites**: each binding names where its export is declared
  (`LUCENT_TRACE_SITE_AT`, the same path as `#line`), so a trace of a call
  points at the `.lucent.ts` declaration rather than at generated code;
  native spans inside Lucent code (`LUCENT_TRACE_SCOPE`) get theirs from
  the `#line` in force.
- **Semantic IR** (`ir/`, internal and off by default): a typed
  representation between the checker and the C++ tree, in which every
  value is defined once by an operation and operations run in list order,
  so evaluation order is data. Control flow is structured: `if`, `loop`
  and `block` operations own nested regions, which `break`, `continue`
  and `yield` (an `if`'s result) leave. `LUCENT_LOWERING=ir` lowers the
  top-level functions it supports through it (literals, arithmetic,
  bitwise and comparison operators, on numbers and bigints, string concatenation and templates,
  locals, parameters and module variables with every assignment form,
  calls of the module's functions, `new Error`, conditional and logical
  expressions, `typeof`, blocks, `if`, `while`, `do`, `for`, `switch`,
  labels, `break`, `continue`, `return` and `throw`, and the checker's
  narrowing of optionals and unions) and leaves the others to the emitter
  above; `ir-strict` fails on anything it does not support. Conversions
  between optionals, unions and absent values are planned once, in
  `lowering/conversions.ts`, for both lowerings. A verifier checks each function (definitions before uses and
  inside their region, types, terminators, jump targets, branch results,
  spans, effect claims) before any C++ exists, and the C++ gives every
  call its own statement; a jump is C++'s `break` or `continue` when that
  reaches its target, a `goto` otherwise. The e2e runner compiles under
  whichever mode is set.
- **Program analyses** (`analysis/`, internal): for each program and target,
  `programFacts` summarizes once what each unit of code may do: functions,
  closures, methods, accessors, a class's construction and each module's
  initialization, without other platforms' branches. A unit's own facts
  (the module state it reads or writes, allocation, throwing, suspension,
  and native calls with their binding plans' thread and blocking facts)
  are joined with those of the units it calls, the callbacks it runs (a
  library's `map`, a native call's during-call callback, a function it
  passes to a parameter its callee calls) and, at each native call, the
  Lucent code native code may call back while the call runs: not what
  the platform's call queues on the Lucent thread (its binding plan's
  `queued` delivery, a turn of its own) nor compute tasks, which the
  runtime runs. What code called back does (a kept callback, an override
  of a platform class, a requirement) is recorded apart, as `calledBack`:
  it runs in the context its glue enters (module code holding the Lucent
  lock; a component setup's own callbacks in the main context, checked
  with the setup), so the IR's effects count it and the main-thread and
  task checks of the caller do not. Module state is a `let`, or a
  const holding an object: `readonly` does not make its contents
  immutable. Facts only rise, so iterating to a fixed point handles
  recursion; units are processed in a fixed order and keep the first
  cause found, so the results and the call paths explaining them are the
  same on every build. What the compiler cannot see (a function value it
  cannot follow, a library member it does not know, an iterator) stays
  unknown. A program-wide graph of where object and function values flow
  (variables, literals, closures, calls) resolves function values, tells
  a mutation of module state from one of a new object, and finds how a
  value escapes (returned, stored, kept by a callee, used after `await`).
  Owner checks built on them tell whether a unit can run on an execution
  context: a compute task refuses module state, module constants that are
  not literals (a reload of JavaScript runs `init()` again, which assigns
  them while a task may read them; code reads a literal constant as its
  literal, not from storage), main-thread or unknown native code, code the
  compiler cannot see and asynchronous work; the
  main thread refuses module state, worker-only or blocking native code
  and code the compiler cannot see. Other checks cover what a closure
  captures, whether a value's type can be handed to another context
  (plain data can, and a `NativeBuffer` moves; functions, promises,
  main-thread native objects and byte spans cannot) and the contexts that
  run each unit: exports and module
  initialization on the module's thread, native callbacks where their
  plans say, `main()` closures on the main thread. Each refusal names its
  cause path: `run` calls `decode`, which reads module state `cache`.
  A `NativeBuffer` borrow (`emit/buffers.ts`) lends its callback a span
  that must not escape by any of those paths; the same module reports a
  buffer used after it certainly moved (`transfer()`, a compute handoff).
  Under `LUCENT_LOWERING=ir`, each lowered function's effect record, and
  each call's throw claim, is its summary; the verifier checks a record
  admits the mutable module variables it loads and stores and what the
  functions it calls do (a const holding a number is not state).
- **Components** (`ui/`): an exported function of a `.lucent.tsx` module
  whose code, in the target's branches, returns a platform view (a class
  deriving from UIKit's `UIView` or Android's `View`, the classes Fabric
  hosts) is a component. It is described, not emitted: the emitter leaves
  its declaration out, so it is not a function of the module's
  JavaScript. The description (`ui/contract.ts`, `CompileResult.components`)
  is the one source for code generators and platform hosts: identity
  `<package>/<module path>#<export>` (a Lucent package's path under its
  sources, an app's under the directory of its package.json, platform
  files sharing their module's), a registration name derived from the
  identity alone, props (plain data: numbers, strings, booleans, string
  literal unions, arrays and plain objects, each possibly null or
  missing), events (callback props named `on…`, returning nothing, each
  with a slot number in prop order and a delivery: discrete, or
  continuous or coalesced when `lucent:ui`'s `Continuous<F>` or
  `Coalesced<F>` marks its type), ref commands (the object literal
  setup gives `lucent:ui`'s `expose` once, at its top level: void commands
  enqueue, others answer a promise), whether it takes React children (a
  `children` prop of `lucent:ui`'s `Children` type, which needs setup to
  make their slot with `slot<T>()` once, in a `const` at its top level,
  `T` the platform's container class: UIKit's `UIView`, Android's
  `ViewGroup`, `ui/roots.ts`), and per platform the returned class and
  the class the host registers.
  Setup, the functions it creates and those its commands name are checked
  for the main thread with the program analysis, where calling an event prop (`props.onChange?.(v)`)
  only posts its arguments. Each target describes its components;
  `ui/merge.ts` joins them and refuses a contract that differs between
  platforms, or from a split module's shared declaration.

  Under `LUCENT_VIEWS=fabric` (internal, off by default: components are
  then only described), each target's native code gets each component's
  Fabric sources, generated from its description (`ui/fabric.ts`):
  `views/<registration>.h/.cpp` in namespace
  `lucent::views::<registration>` (a `Props` deriving from `ViewProps`
  whose values are each missing or their value, the events JavaScript
  listens to and the props a commit changed; an `EventEmitter` with one
  `emit` per event, dispatched in React Native's discrete or continuous
  category, or as a unique event for a coalesced one (which replaces the
  view's latest waiting event of its type); the `ShadowNode` and
  `ComponentDescriptor`; the
  commands' typed arguments), and `views/lucent_views.h`, whose
  `registerComponents` adds every descriptor. Each module's proxy exports
  its components (`ui/proxy.ts`) as React components the views runtime
  (`runtime/js/views.js`) makes from a generated description; their
  React-facing declarations come from `componentDeclarations`, written
  to the native package's `types/views/<module>.d.ts`, and a module's API
  hash covers its components' contracts. Props and
  event handlers travel under keys of their own (`ui/transport.ts`:
  `p<index>`, `e<slot>`, events `lucent<slot>`), never meeting React
  Native's view props; a nullable value travels boxed (`[value]`),
  because React sends a removed prop as null; an event's arguments
  travel by position (`{ args }`), because React Native sets `target` on
  every payload. A command that answers
  carries a request id, settled through the native host's
  `__lucentViewRequests` channel, once: with the command's result or
  error, or with an `AbortError` if its view unmounts first. A command
  sent while the view is not mounted fails with an `InvalidStateError`.

  Under the same switch, each component's setup is compiled
  (`emit/setups.ts`), with `lucent:ui`'s helpers (`native`, `effect`,
  `signal`, `expose`, `onDispose`, `slot`, `invalidateSize`, and the
  event marks `Continuous` and `Coalesced`: experimental, resolving only
  under the switch). In the module's namespace, `<Export>_Props` holds a
  signal (`lucent/view.h`, on the main context's reactive graph) per
  prop and a route per event, `<Export>_Commands` the functions setup
  exposes, and `<Export>_setup(props, commands)` returns the view: a
  function JavaScript does not see. A component taking React children
  gets its host's slot as a third parameter, which `slot()` in setup is;
  setup places it in its view, and never reads `props.children`. Reading `props.name` reads the
  prop's signal, so inside an effect the effect runs again when a commit
  changes it; calling an event prop sends it along its route; setup and
  every function it creates run on the main thread, and a function setup
  gives the platform (a block, a listener) enters the main context when
  called, never taking the Lucent lock (a Lucent class given to the
  platform from a setup is refused: its methods run in module code).
  Every function setup creates also enters its mount whenever it runs
  (`lucent::ui::inContent` over `lucent_content`, the mount setup ran
  for, which the setup and the functions on the way capture), so the
  host hears that the mount's code ran; `invalidateSize()` marks that
  mount from code that runs in no such function (after an await). A
  prop read while
  setup runs (outside any function) is a warning: setup runs once, so
  later commits never reach it. `views/<registration>_mount.cpp` defines
  the component's `Mount` (declared in its Fabric header), which a
  platform host drives: `create` (committed mount: the props' signals,
  converted from the commit's values by `rn/LucentViewValues.h`, the
  events' routes to the host's `emit`, then setup, once, in the mount's
  scope, with the slot the host made for this mount if the component
  takes children), `update` (a commit's changed props and listened-to events, as
  one transaction of the mount's prop inbox, applied at once on the main
  thread), `setEmit` (a new emitter; setup's native subscriptions stay; none after dispose),
  `command` (after the pending props; a request answers once through
  `lucent::views::Respond`, a promise's answer owed by the mount until
  it settles) and `dispose` (the scope ends; the event routes, the
  host's `emit` and the view are released, requests still owed are
  rejected, and what answers later is dropped; later calls do nothing). Each enters the main context itself, so a host calls it
  from the platform's main thread as it is. Errors setup and commands throw are reported with the
  component's identity and source line (`lucent::ui::reportViewError`);
  effects are named by their source line in loop reports.

  On iOS each component gets `views/<registration>ComponentView.mm`
  (`emit/views.ts`), a subclass of the shared host `LucentComponentView`
  (`runtime/cpp/rn`) that registers with React Native's component view
  factory as it loads and provides the Fabric descriptor. The host mounts
  when a commit's updates are final on the main thread, giving the mount
  a `MountToken` {tag, generation}, and creates the component's `Mount`;
  hands it each later commit; parses commands for it, answering a request
  through the `Requester` of the runtime that sent it while the view
  still holds that mount (`answerTo`; dropped once the view holds
  another, or once that runtime is torn down); sends its events through the view's current
  event emitter while the view holds that mount; and disposes it when the
  view is recycled. The React children React Native mounts in the view
  never go beside the content: the host keeps them in React Native's
  order and, for a component taking children, puts them in the slot it
  makes for each mount (`LucentSlotView`, `rn/LucentViewChildren.h`),
  taking out only those React Native unmounts. The slot shows each child
  at the frame Yoga gave it in the component's coordinates, wherever the
  setup put it (its bounds' origin is its origin in the host, realigned
  at each layout and after each commit and command), and clips
  them to its bounds; it never lays them out. Children given to a
  component taking none, and a slot the setup leaves out of its view,
  are reported.

  Android mounts views from Java, so its host is split. Each component
  gets a manager (`dev.lucent.generated.<registration>Manager`, a
  `LucentViewManager` named as the component is registered), which
  `LucentPackage` returns, and `views/<registration>_android.cpp`
  (`emit/views.ts`): the same `LucentMounted` over the `Mount` as on
  iOS, made by `mount` and listed, with `requestIdOf`, by
  `views/lucent_hosts.cpp`. lucent build lists each descriptor for React
  Native's autolinking (`componentDescriptors` in react-native.config.js,
  with the `ComponentDescriptors.h` autolinking includes) wrapped in
  `HostDescriptor` (`runtime/cpp/rn/LucentViewsAndroid.h`), which records
  each view's event emitter by surface and tag (`LucentViewRegistry.h`:
  each JavaScript runtime numbers its views again, so a tag alone would
  be reused across a reload), since Java never hands it on. The
  manager passes each commit's props (what changed) and each command to
  the C++ host (`LucentViewsAndroid.cpp`), which applies the props through
  the component's `Props`, mounts once the view is attached or sent a
  command (a commit is on screen by then, which a preallocated view's is
  not) with a `MountToken` of its own, hands the mount each later commit
  and command as the iOS host does, shows its view in the shell
  (`LucentHostView`), and disposes of it when the view is dropped or
  recycled (the managers pool dropped views when the app turns React
  Native's `enableViewRecycling` on; iOS recycles them always). The manager is also the view's `IViewGroupManager`: React
  Native adds and removes the view's children through it, and they go
  where the iOS host puts them, by the same rules (`LucentChildren`,
  plain Java): in React Native's order, in the slot the shell makes for
  each mount of a component taking children (`LucentSlotView`, which the
  C++ host hands the mount), never in the shell. React Native lays them
  out (`needsCustomLayoutForChildren` is false); the slot never does, and
  scrolls its content by its own position in the host, at each layout and
  before each frame, so they show at Yoga's frames.

  An Android component may write its content as Jetpack Compose
  (`lucent:compose`, experimental, resolving only under the switch, in
  `.android.lucent.tsx` files): setup returns `compose(() => …)`, whose
  body (`ui/compose.ts`) is compiled to Kotlin, never to C++
  (`ui/toolkit-body.ts` finds toolkit bodies, and keeps them out of the
  analysis and the emitter).
  The body is in call form, as SwiftUI's: a composable takes Kotlin's
  named arguments as one object literal, and its trailing content lambda
  is a function returning an array of what it shows. Its calls, modifier
  chains, `remember`, effects and animations are Compose's own.
  `lucent:compose` declares them from Compose's bindings: Lucent ships
  the schemas of the Compose release its Android library builds with
  (`lib/sdk/compose.schemas.json.gz`, made by `scripts/compose-bindings.ts`
  with bindgen's `extractKotlinApi`, which reads the libraries' Kotlin
  metadata and annotations, and plans them on a `kotlin-source` backend).
  `ui/compose-dts.ts` writes the declarations after `lucent:compose`'s own
  (`lib/sdk/compose.d.ts`) by rules, and keeps each one's binding: the
  schema member, with each parameter's name, position, kind (content,
  callback or value), default and Kotlin type (Float, Int and Long are
  branded numbers, so generics keep them), and how its Kotlin is written.
  The writer reads the bindings (`ui/compose-api.ts`). `lucent sdk`
  lists, shows and counts Compose's packages as Android modules when views
  are on (`sdk/modules.ts`). What the body takes from its setup is a slot of a
  generated state holder: a number, boolean or string the setup computes
  (the largest such expression reading its props, signals or functions)
  is Compose state, which an effect of the setup (`emit/toolkit.ts`, the
  holder `emit/compose.ts` makes) sets on the main context whenever what
  it read changes; a setup function the body calls from a callback (an
  action) is a Kotlin function object entering the main context when
  called (`lucent/platform/compose.h`). `ui/toolkit-body.ts` finds both
  kinds of slot for every toolkit.
  The program's Kotlin gets `dev/lucent/compose/<registration>.kt` (the
  `…State` class, the `@Composable …Content`, the `…Host` object giving
  it to the runtime's `LucentComposition`, which owns the ComposeView,
  its composition and their end: `runtime/native/android/src/compose`),
  and the Android library then applies the Compose compiler plugin at the
  app's Kotlin version, depends on Compose's BOM and compiles the
  runtime's Compose sources (`native-build-files.ts`). The Android host
  gives the setup the context of the shell it mounts in
  (`jni::hostContext()` while setup runs), which the ComposeView is made
  with.

  Sizing (`runtime/cpp/rn/LucentViewSizing.h`, over the plain exchange
  in `lucent/sizing.h`): a component with a size of its own (explicit,
  or given by flex) fills it. A component taking React children is a
  Yoga container (`SlotShadowNode`, `runtime/cpp/rn/LucentViewSlots.h`):
  sized by its style, flex and children, as a View is, never by
  measuring its content. Any other without a size of its own is sized by its content: its
  shadow node (`HostShadowNode`) is a measurable Yoga leaf that lays out
  at the latest measurement its state holds (zero before the first, the
  previous one while the host measures under new constraints) and
  records in its state the constraints its layout asked for (both
  bounds, the font scale and the layout direction) when that
  measurement does not answer them. A measurement answers the
  constraints it was made under and stricter bounds its size still fits
  within, the rule Yoga's own measure cache follows, so a column's
  height bound shrinking as siblings are added measures nothing again.
  The host measures its view under the constraints on the main thread
  and posts the size, with those constraints and its content's
  revision, as a state update; the renderer keeps it only if it is
  still current (`judge`: it answers the constraints asked for now, and
  is from no older revision than the one held). No thread waits for
  another. The host enters its mount (`view.h`'s `Content`) to set it
  up and to hand it each commit and command, and every function the
  setup made enters it too whenever it runs (a native callback, an
  effect): once the outermost entry ends, the content has a new
  revision and is measured again if the shadow tree needs its size, as
  it is when a commit's state asks for other constraints. A result
  that no longer settles its state after 3 posts (size and constraints
  changing each other) stops the host, logged, until the content
  changes. On iOS the setup's view is the host's content view, laid out
  in its content box (frame less border and padding) at each layout,
  and measured with `sizeThatFits:`, and also on the turn after the
  text size the user chose changes (content that follows Dynamic Type
  changes size with no Lucent code running, and React Native lays
  nothing out again for it). On Android the shell takes Yoga's
  border and padding as its own padding and lays its content out
  inside them; the manager hands each commit's state to the C++ host,
  which measures the content through the shell (`View.measure` at most
  the constraints, in density-independent pixels), and also when the
  content asks for a layout (the shell's coalesced relayout: a backstop
  for a native change no Lucent code made).
  An iOS component may draw with SwiftUI instead (`lucent:swiftui`,
  internal under the same switch): its setup returns `swiftUI(() => …)`,
  whose function is its body, in call form, and whose value, the
  `UIHostingController` the Swift side makes, is the component's root
  (`ui/toolkits.ts` lists each toolkit's body function, root class and,
  for SwiftUI, the module its declarations come from). `lucent:swiftui`
  is generated from the SDK's SwiftUI, extracted as a module written as
  source (bindgen's `swift-source.ts`, `sdkSourceModule`: SwiftUI and
  SwiftUICore, which is publicly part of it, cached like the SDK's
  schemas): each parameter records its Swift label and whether it is a
  value, an action or a builder's content, `callForms` (`call-form.ts`)
  turns those into Lucent's call form, and `sdk/toolkit-dts.ts` declares
  one overload per form, tagged `@swift <symbol> <form>`, served from
  the SDK's virtual directory. What the call form cannot write yet is
  skipped, or refused by the member's plan (`source-plan.ts`, backend
  `swift-source`); `lucent sdk coverage --ios SwiftUI` counts both, in a
  `lucent:swiftui` row after SwiftUI's while views are on. `emit/swiftui.ts` writes the body out as Swift
  (`views/<registration>.swift`: the view, an `ObservableObject` model,
  and `@_cdecl` functions), each call from its member's facts
  (`ui/source-members.ts` follows the tag back), refusing what the plan
  refuses and members newer than the oldest iOS apps run on; the rest of
  the setup is compiled as any setup's. Literals and SwiftUI's own values stay Swift; a value slot is
  a property of the model, which an effect of the setup sets; an action
  slot is a setup function the Swift calls by index
  (`lucent/platform/swiftui.h`); a conditional view in content is
  SwiftUI's `if`. `withAnimation` in the setup's code calls a per-site
  shim that runs SwiftUI's withAnimation around the Lucent code, whose
  effects run inside it. The component's `LucentMounted` gives the
  controller to the host as its `controller()`, and the host shows its
  view and contains it in the nearest view controller. The controller
  (a generated `UIHostingController` subclass) tracks its content's
  ideal size (iOS 16), and each change marks the mount's content
  (`lucent::swiftui::resized`, `invalidateSize`), so a size SwiftUI
  changes on its own is measured again.
  [design/views.md](design/views.md) records what the hosts do at run
  time: registration, the mount lifecycle, routing, threads, sizing,
  toolkit bodies and the limitations accepted.

## Runtime

`packages/runtime/cpp/lucent` is header-heavy C++20 with no dependencies
beyond the standard library, plus JSI for the boundary (`lucent/jsi`).

- `jsstring.h`: `lucent::String`, an immutable, shared, UTF-16 string with a
  Latin-1 fast path. When the handle is the only owner, `+=` appends in place,
  so building a string in a loop is linear.
- `number.h`: ECMAScript number semantics. `toString` and `toExponential()`
  produce the shortest digits that read back as the double, the closest of
  those, with Dragonbox (`cpp/third_party/dragonbox`, as Hermes does);
  `toFixed`, `toPrecision` and `toExponential(n)` round on the exact binary
  value; `toString(radix)` follows V8's digits. A seeded corpus of node's
  answers (`number/corpus.ts`) checks every form.
- `bigint.h`: `BigInt`, JavaScript's `bigint` at any precision. A value
  that fits in 64 bits is held inline and never allocates; a larger one
  shares immutable 32-bit limbs, so a copy is a reference count. The form
  is canonical, so equality, ordering and hashing (Map and Set keys) are
  exact and cheap. Division truncates, bitwise operators and shifts act on
  an infinite two's complement, and results beyond 2^30 bits throw a
  `RangeError`, as in V8. Native 64-bit values convert exactly
  (`toInt64`, `toUint64`: `RangeError` out of range) or wrapping
  (`wrapToInt64`: `BigInt.asIntN(64)`); `toNativeInteger<I>` is what SDK
  glue passes a native API (NSInteger, jlong, a struct field's own C type:
  `RangeError` naming the parameter beyond its range), and `BigInt(v)`
  reads any native integer exactly. `compare` orders a bigint against a
  double exactly. A seeded corpus of node's answers (`bigint/corpus.ts`)
  checks every operation.
- `array.h`, `map.h`, `bytes.h`: shared containers with JS semantics.
- `async.h`: `Promise<T>` as a coroutine type. Bodies start eagerly, and
  `await` always resumes from the microtask queue of the execution context
  that awaited, so a coroutine stays on the context it started on. A
  promise's state changes only on the context that made it: settling or
  observing it from another thread posts there.
- `execution.h`, `scheduler.h`: execution contexts. A context runs turns in
  order on its executor, each turn followed by the context's own
  microtasks, and owns a root scope (`scope.h`): disposing a scope under it
  from another thread, or dropping its last reference there, posts the
  disposal to the context. The legacy module context
  (`Scheduler`) runs every module's code: its turns run on the Lucent
  thread, and synchronous calls from other threads enter it by taking one
  recursive lock (`LucentScope`), which serializes all module code. The
  lock is fair (a ticket lock): threads get it in the order they asked, so
  the Lucent thread, retaking it between the turns of a loop that yields,
  queues behind a JS thread already waiting to call in. Its
  microtasks run only once the stack is empty: at the end of a turn, or in
  a turn posted when a call from another thread leaves. The main context
  runs on the platform's UI loop and never takes the lock; isolated
  contexts each have a thread. A context is entered synchronously only on
  its own thread (`ContextEntry`); everything else crosses as posted jobs,
  so no context waits for another.
- `callback.h`: `fromCallback` and `subscribe` (`lucent:core`), a promise
  or a subscription over any callback API. Each is an `Operation` under the
  calling context's root scope, following the signal until it settles: it
  settles once, at the first of its callbacks, the signal and the scope's
  disposal, and runs the registration's cleanup once, then (or when the
  registration returns it, if it settled during registration). Everything
  it runs belongs to the context it was called on: the functions it hands
  out, called from another thread, post there in call order, so the value
  handler, the cleanup and the promise's settlement never run elsewhere. The
  registration returns its cleanup as it declares it (a function, maybe
  absent, or nothing); the compiler lowers the call from a table of
  `lucent:core` helpers (`emit/core.ts`).
- `resource.h`: `Resource`, the lifecycle of something Lucent code opens
  and must close once (open, closing while its release runs, closed). It
  closes at the first of an explicit `close()` (idempotent), the disposal
  of the scope it belongs to (which refers to it weakly), or its last
  reference going; the release runs once, on the context the resource
  requires. Using it after that throws `InvalidStateError`.
- `operation.h`: native work as a promise. `nativeOperation(registration,
signal)` starts native work that completes later, on any thread (a
  Kotlin coroutine, a platform callback), as an `Operation` under the
  calling context's root scope, and returns a promise that settles on that
  context. The registration begins the work and returns what ends it.
  Disposing the scope, or the signal aborting, cancels it: the promise
  rejects at once, the work is told to stop, and a result it produces
  after that is released, never delivered. An already aborted signal
  never starts it.
- `lifecycle.h`: the app's and its scenes' lifecycle. The platform adapter
  reports on the main thread what the platform posts: the app becoming
  active, going to the background and back, and each scene connecting,
  activating and disconnecting. Scenes are `SceneId`s, never pointers,
  listed most recently activated first, and each connected scene has a
  scope that its disconnection disposes. Lucent code subscribes to an
  event from any thread: a subscription is a `Resource` that the lifecycle
  keeps open until it is closed or its scope is disposed (dropping the
  handle does not end it). Listeners run on the main thread in
  subscription order; one that throws is reported and the rest run.
- `presentation.h`: UI shown in a scene until a result, as an `Operation`
  under the caller's scope. It settles once, at the first of a result, an
  error, the caller's signal, the scope's disposal or the scene's
  disconnection, and whatever settles it dismisses what it showed, on the
  main thread. With no scene in the foreground it fails with an
  `InvalidStateError` and shows nothing.
- `platform/ios_ui.h`: the UIKit side of both. From the moment the binary
  loads, observers of UIKit's notifications (not a replaced app or scene
  delegate, so the app's and other modules' keep working) report to the
  shared lifecycle; each scene is tagged with its `SceneId`, and found
  again through a weak table. The presentation context (the scene to
  present from, its key window and top view controller) is looked up in
  UIKit each time it is asked for, on the main thread, and never kept. A
  presented view controller is held weakly: the person dismissing it (as
  its presentation controller's delegate, when it has none) or its
  release cancels the presentation.
- `transport.h`: what a compute task receives. Its input is copied at
  submission into a graph only the task holds: each array, collection,
  byte buffer, date and object once, so aliases and cycles survive;
  strings cross as they are (immutable). A type crosses if it has a
  `Transport` (the runtime's value types do; structs and classes get one
  from `transportObject`); functions, promises and signals do not compile,
  and an object of a subclass behind its base type is refused with a
  `DataCloneError`. A transport that moves ownership rather than copying
  registers the move with the graph, which commits it only once the whole
  input has been copied.
- `compute.h`: isolated compute. `compute(entry, input)` copies the input
  (`transport.h`), runs the entry (a compiled function taking the task's
  own input and a `TaskContext`) on a bounded pool, and returns a promise
  that settles on the calling context; the result is moved back, not
  copied. The pool has one worker fewer than the cores (at least one),
  each an isolated context that never takes the Lucent lock or waits for
  the UI loop, and a queue of 1024 tasks waiting for a worker; a
  submission that finds it full is rejected at once with a
  `QuotaExceededError`, never blocking the caller. A task is an
  `Operation` under a scope (by default the calling context's root): it
  settles once, from its outcome or from a cancellation (its signal, its
  scope's disposal, the pool's shutdown), which rejects the promise at
  once. A queued task then leaves the queue; a running one stops at its
  next safepoint (`TaskContext::checkCancelled`, one relaxed load), and
  native code between safepoints runs to its end. What loses is released,
  never delivered: on the worker, or on the owner if the outcome was
  already posted there. Each task has a scope of its own, disposed on its
  worker when it returns. The pool counts what it does (`stats()`) and,
  when given a sink, times each task: taking its lock, waiting for a
  worker, running, and reaching the owner.
- `buffer.h`: `NativeBuffer`, bytes native code owns: allocated, or
  adopted with the release it requires and the executor that release runs
  on. A reference keeps the handle alive, not access to the bytes: that is
  a borrow for one synchronous call (`withRead`, `withWrite`). Reads share,
  a write excludes every other borrow, and a conflicting borrow is refused
  at once with an `InvalidStateError`, from any thread. The storage is
  released once, at `close()` (refused while borrowed; false once closed)
  or when the last reference goes, on its executor; aliases then refuse
  access. Copies are explicit (`toBytes`, `fromBytes`) and counted.
  `transfer()` moves the storage, uncopied, to a new handle one generation
  on, and every alias of the old one refuses access from then on (closing
  it returns false). A borrowed or closed buffer does not move. That is how
  a buffer crosses to a compute task: its `Transport` moves it once per
  input, committed only once the whole input has been copied (a failed copy
  leaves the sender open); after that the storage follows the task's
  handle, so a refused submission or a cancelled task releases it.
  Compiled code borrows through `withRead(buffer, f)` and
  `withWrite(buffer, f)`, which lend `f` a `ByteSpan` or `MutableByteSpan`:
  the borrowed bytes with a `Uint8Array`'s element semantics, which the
  compiler keeps inside `f`. `copyOut` and `copyIn` are the counted copies
  for callers that cannot be lent the storage (JavaScript). `lucent.h`
  includes it.
- `view.h`: what compiled views share: the main context's reactive
  graph (`mainGraph`), `Event`, whose copies share one route the view's
  host replaces without setup running again, `reportViewError`, and
  `Content`, how a mount's host hears that the mount's code ran and may
  have changed the views it sizes: a `ContentEntry` marks the mount's
  content while its code runs (`inContent` wraps a function so it
  enters its mount whenever it runs), and the host's `changed` runs
  once, when the outermost entry on the main context ends.
  `invalidateSize` marks it outside any entry (after an await): the host
  hears in a later turn. Marks made while the host measures are not
  changes.
- `reactive.h`: the UI's reactive graph (the state a view keeps), owned by
  one execution context, the main one for views: used from any other
  thread it throws, and it never takes the Lucent lock or waits for the JS
  thread. A signal notifies when a write changes its value by `Object.is`
  (NaN is itself, 0 and -0 differ): an object by identity, so mutating one
  in place notifies nothing until a new one is set; `Opt` keeps missing,
  null and a value apart. A computed value is evaluated when read, and
  again only when a source it read last time changed since (computed
  sources brought up to date first, in the order read); an unchanged
  result stops there, an error is kept and rethrown to readers until a
  source changes, and it cannot write a signal or read itself. An effect
  runs once when made, then after something it read changed; each run
  replaces what the last one read. Before it reruns, and when it or its
  scope is disposed, its last run's scope is disposed without tracking:
  tasks started in it cancelled (a continuation that arrives later is
  dropped), then its cleanups and nested effects in reverse order. Writes
  inside a transaction, an effect or a cleanup wait for it to end, and the
  outermost end runs the pending effects at once, in the order they were
  made: an effect never sees half of a transaction (a view's props commit
  as one), and nothing waits for a frame. Only the synchronous run tracks:
  cleanups, `untracked`, and code after an `await` subscribe to nothing.
  An effect about to run more than `loopLimit` (100) times in one update
  stops it, and the loop is reported as the chain of effects that made
  each other pending; the rest wait for their next change. Errors nobody
  can catch (an effect's, its cleanups', a loop) go to `reportUncaught`.
  `test/reactive/reference.ts` states the same rules in plain JavaScript,
  and a seeded corpus of scenarios (`test/reactive/corpus.ts`) must give
  the same log on both. A mount's props reach it through a `PropInbox`:
  each commit is the fields that changed, each a write of an already
  converted value (never a JSI value), posted from any thread. Commits
  coalesce until the UI applies them all in one transaction, a field's
  later write replacing its earlier one, so effects see one committed
  state; code on the UI that must answer now (a command, a measurement)
  applies what is pending first rather than waiting for the posted job.
  Disposing the mount drops pending commits and refuses new ones.
- `trace.h`: tracing, off by default (one relaxed load where it is
  checked). Started, it keeps the latest events in a bounded buffer and
  counts those it drops: a posted job's wait for its owner and its run, a
  wait for the Lucent lock, a compute task's wait for a worker, run and
  delivery (and the pool's saturation), a copy's bytes, native buffer
  copies and allocations, and native spans (`LUCENT_TRACE_SCOPE`) with the
  source site their `#line` names. Events that belong together share a
  correlation id; a job posted from another names it as its parent. It
  exports a Chrome trace, and on request mirrors spans live into
  `os_signpost` (Instruments) or ATrace (Perfetto). `LUCENT_TRACE` (on
  Android, the `debug.lucent.trace` property) starts it with the module
  context. [tracing.md](tracing.md) says how to capture and read one.
- `report.h`: `reportUncaught`, where every error no Lucent code can catch
  goes (a job's, a cleanup's, a platform callback's): the platform's log
  and stderr.
- `jsi/host.h`: one `Host` per JS runtime, with an id (`RuntimeId`) no
  other host has had; a new host for a runtime replaces, and tears down,
  the one it had. It owns every JSI reference Lucent holds (promise
  resolvers, callbacks, class prototypes, the identity cache).
  An anchor object on `global` tears it down while the runtime does.
  Native code refers to JSI objects only by id and hops to the JS thread to use
  them. Work for the runtime belongs to the host's scope, under the legacy
  module context's root. Tearing the host down (a reload, the runtime's
  end, a new host) disposes it: posted work that has not started is
  dropped, and Lucent code awaiting a JS promise, or a JS callback's,
  resumes with an `AbortError`. A task for the JS thread that never runs
  is released on the legacy module context, with the values it carries.
  Torn down while the runtime is usable (`invalidate()`), the host first
  rejects the JS promises it still owes. A native instance has one JS
  object per runtime (the identity cache is keyed by the instance), and
  the host that made it: once that host is torn down, the object is
  refused with a `TypeError`. `Host::ownership()` reports what a host
  holds (promises it owes, JS functions, cached objects, prototypes,
  modules, its scope's registrations, tasks in flight); debug builds show
  it to JavaScript as `__lucentHost.ownership`. `Host::identity()` gives
  JavaScript the build identity (see [Build identity](#build-identity)),
  as the `__lucentIdentity` property next to the modules.
- `regexp.h`: `RegExp` on QuickJS's `libregexp` (vendored, MIT, in
  `cpp/third_party/quickjs`), which matches Latin-1 and UTF-16 buffers
  directly; compiled patterns are cached by source and flags.
- `jsi/convert.h`: `Convert<T>` between JSI values and Lucent values. The
  compiler emits specializations for structs, classes and unions. A
  bigint crosses exactly: through `jsi::BigInt`'s 64-bit forms when it
  fits, else through its digits (the JS side's `BigInt` builds the value
  it receives). A `NativeBuffer` crosses as an opaque handle (one JS object
  per buffer, like a class instance) whose `withRead` and `withWrite` lend
  JavaScript a copy of the bytes under the borrow, written back after a
  write: JavaScript never holds an `ArrayBuffer` over the storage. Each
  binding passes `callSync` or `callAsync` its export's trace site (name,
  `.lucent.ts` file and line): traced, a synchronous call is an entry span
  there, and an async one shares one id across its call, the job it posts,
  its result's wait for the JS thread and its delivery.
- `abort.h`: `AbortController` / `AbortSignal`. A signal from JavaScript is
  mirrored by a native signal stored as `NativeState` on the JS object; an
  `abort` listener on the JS signal aborts the mirror synchronously on the JS
  thread, under the Lucent lock, so native listeners run in the same turn as
  JavaScript's. A signal belongs to the context it was made in: aborting it
  or changing its listeners from another thread is posted there, where the
  listeners run, and what a listener throws goes to `reportUncaught`.

## React Native integration

`LucentModule` is a C++ TurboModule. Its `create(runtime, name)` returns the
exports object of the Lucent module `name`, built on first access.

- **iOS**: `LucentRegistration.mm` registers the module in React Native's
  global C++ TurboModule map from `+load`. No codegen and no app delegate changes.
- **Android**: the package is a _pure C++ dependency_. React Native's gradle
  plugin adds `android/CMakeLists.txt` to the app's `appmodules` build and
  generates `autolinking_cxxModuleProvider`, which instantiates `LucentModule`.
  Its Android library also has the runtime's Java: `NativeProxy` for Java
  interfaces Lucent implements, the components' managers (their views,
  under `LUCENT_VIEWS=fabric`), and `LucentActivities`, started by the
  `LucentInitializer` provider its manifest declares, which tracks the
  app's Activities and asks for activity results and permissions through
  the translucent `LucentRequestActivity`.

Both React Native CLI and Expo autolinking read the app's
`react-native.config.js`, whose `lucent` entry points at `.lucent/native`.

On the JavaScript side, each proxy requires the loader
(`js/_lucent/runtime.js`) and calls
`loadModule(name, () => require("react-native").TurboModuleRegistry, require("./_lucent/identity.js"))`,
which checks the app's native code first (see
[Build identity](#build-identity)).
Resolving `react-native` from the app's own location avoids picking up a second
copy in monorepos.

## Build identity

The app binary and the JavaScript bundle are built apart, and may be from
different sources: the app was not rebuilt after an edit, or a JavaScript
update reached an older binary. Each compile gives what it built an
identity (`src/emit/identity.ts`):

- the **runtime ABI** (`RUNTIME_ABI`, the runtime's `kRuntimeAbi`) that
  generated code and proxies expect of the runtime; generated code
  `static_assert`s it as it builds;
- per target (`ios`, `android`, `host`, or `all` for a program every
  target shares), the **program hash**: the generated files' content,
  without `#line` directives (machine paths; code moved to other lines is
  the same program);
- per target and module, the **API hash**: what JavaScript sees of the
  module, its exports and their signatures, with the struct fields, class
  members, subclasses and interface implementations that cross with them.
  A body edit changes the program, not the API.

`lucent_identity.cpp` defines `lucent::js::buildIdentity()` for the
program it is part of, and the host answers `__lucentIdentity` with it:
`{host, runtimeAbi, target, program, modules: {name: api}}`. The whole
compile's identity is `js/_lucent/identity.js`, which every proxy passes
the loader, and the native package's `manifest.json`. A body edit
rewrites that file, not the proxies.

Before a module loads, the loader compares the two. Its errors carry
`code: "LUCENT_NATIVE_MISMATCH"` and the pending action kind to take:

| The app's native code                                | Result                                   |
| ---------------------------------------------------- | ---------------------------------------- |
| has no identity (built before them)                  | error, `compile-native`                  |
| has an older runtime ABI                             | error, `compile-native`                  |
| has a newer runtime ABI                              | error, `reload-js`                       |
| is for a target this JavaScript was not compiled for | error, `compile-native`                  |
| lacks the module, or has another API for it          | error, `compile-native`                  |
| has the same APIs, another program                   | warning, once per host; the module loads |
| is what this JavaScript was built with               | loads                                    |

A different program with the same APIs warns rather than refuses: calls
are safe, only the implementation is older (or newer), and developers
keep working on JavaScript while the app rebuilds. The warning (LogBox,
in development) says so, so nobody runs stale native code without
knowing. Only the runtime ABI orders two builds; otherwise the loader
cannot tell which side is older, so the messages name the rebuild and,
for an app installed after the JavaScript was built, the reload. Neither
claims that a JavaScript update replaces native code. The result is kept
per host and build of the JavaScript: a reload (a new host) or a new
`identity.js` from Metro checks again. Proxies from before identities
pass none, and are not checked.

## Platform code

A module branches on `PLATFORM` (lucent:platform), the standard form: every
target's program resolves both platforms' SDK modules (untyped where an SDK
is missing). `platformScopes` gives each top-level declaration the platform
whose SDK it uses outside a branch and checks every use of platform code;
the emitter leaves other platforms' declarations out and compiles the
target's branch only (`platformTest`, all in `src/platforms.ts`).

Split modules are the opt-in alternative:
`haptics.ios.lucent.ts` and `haptics.android.lucent.ts` implement the exports
`haptics.lucent.ts` declares. `compile()` plans modules
(`src/platforms.ts`), then builds one program per target: the platform's files
plus the shared modules, with the declarations as reference files, and
`lucent:<platform>/*` resolved to `.d.ts` files generated from binding schemas
(`src/sdk/`) and served from a virtual directory. Each target's output is a
complete file set under `<target>/`. Declarations of SDK classes lower to the
`native` LType (`lucent::NativeRef`); `emit/native.ts` maps each use back to
its schema entry through the checker's resolved declaration and emits
Objective-C++ message sends or JNI calls. The runtime side is
`lucent/native.h` and `lucent/platform/{ios,android}`. `native.h` has
`NativeRef`, which names the context its object must be released on (the
main context, for Objective-C objects): whichever thread drops the last
reference, the release runs there. It also has the entry points for
platform callbacks: `postCallback`,
`callNow` and `main(f)`'s `runOnMain` enter module code under the Lucent
lock; `postTo`, `callNowIn` and `runIn` enter another execution context,
such as the main context, without it.
Details: [platform-bindings.md](platform-bindings.md).

Native extensions (`lucent:ext/<name>`) are C, so they need no platform
branch. `resolveNative` checks a package's `extensions` declaration and
locates its header; `bindExtensions` (`src/extensions/bind.ts`) reads the
header through bindgen's `extractCHeader` (clang's JSON AST) and checks the
declaration against it into bindings: handles, functions with one
`ParamBinding` per C parameter, skipped functions with their reasons.
`compile()` binds them for the compile (`src/extensions/registry.ts`), the
program serves `extensionDts` output from the same virtual directory as the
SDKs, handle classes lower to the `handle` LType (`lucent::Handle`), and
`emit/extensions.ts` emits each call as a statement expression: arguments
held in order, converted (a throw there is Lucent's), then the C call inside
`lucent::ext::call`, noexcept, and the failure check its `failsWhen` names.
The analyses get the declared thread and blocking from
`src/extensions/facts.ts`. The runtime side is `lucent/extension.h`: a
Handle's destroy runs once through a `Resource`, on the context its affinity
names.

## Packaging

An app installs one package, `@lucent-lang/lucent`, which depends on
`typescript` only. It holds the CLI (`src/cli`), the Metro integration
(`metro/`), the Expo config plugin (`app.plugin.js`) and the editor plugin
(`ts-plugin/`). Publishing bundles the CLI and the compiler (with bindgen) into
`dist/` with `vp pack` (tsdown), and copies what the compiler reads at run time beside
it: `lib/` (declarations, including `lucent:core`) and `runtime/` (the C++
runtime, native templates and JS loader). The compiler looks for `runtime/`
next to its own code before the workspace's `packages/runtime`, so the same
code runs bundled and from sources. The compiler, bindgen and runtime are
private workspace packages.

Nothing Lucent ships is needed at run time as a package: `lucent build` copies
the runtime and the JS loader into `.lucent/native`, and the generated proxies
require the loader by a relative path, which Metro's transformer rebases onto
the `*.lucent.ts` file each proxy replaces. `lucent:core` is served by the
compiler like `lucent:thread`.

### Build records

`lucent build`, `lucent check`, `lucent dev` and the Gradle and Metro hooks
share one pipeline (`src/cli/pipeline.ts`). Each run writes
`.lucent/build-record.json` (`src/cli/build-graph.ts`): its steps as nodes
(resolve, extract, check, generate) with their inputs and outputs, each a
project-relative path or key and a content hash, the step's status (ok,
cached, failed, skipped), and the action the app needs next (none, reload
JavaScript, compile native code, relink). Timings are kept apart from the
nodes, so a clean rebuild of the same inputs writes the same nodes. The
extract node's inputs are the imported SDK modules, each hashed on the
artifacts its schema was read from, and those artifacts by build-system id
(`sdk:iphonesimulator27.0`, `pod:Name@1.0`, `maven:group:name:1.0`) and
content hash. The `extract:extensions` node's inputs are the native
extensions, each hashed on its header and the native source directories it
may include from. The resolve node's inputs include each path a Lucent package
lists in its `lucent.json` (`packages/<package>/<path>`), hashed by its
files' paths and contents; `.lucent/file-hashes.json` keeps each file's hash
while its size and times hold (a file changed within a second of being
hashed is hashed again). `startedAt` says when each timed step started
(milliseconds from the build's start, outside the node hashes like the
timings), so `lucent trace` (`src/cli/trace.ts`) lays the steps out as
spans beside runtime traces; see [tracing.md](tracing.md).

### SDK usage and the SDK lock

Every SDK use in generated code goes through its binding plan, and the
compiler notes each plan it accepts (`compiler/src/sdk/usage.ts`):
`compile()` returns the program's `sdkUses`, each member once with the
roles it is used in (call, new, get, set, implement), keyed by native
symbol (`bindgen/src/usage.ts`), plus the types of its module that the
used members name. A successful check or build writes them to
`.lucent/sdk-usage.json` (`src/cli/sdk-usage.ts`) with the targets it
compiled and, for each used or imported module, the artifacts its schema
was read from (`id#contentHash`) and the SDK cache entry holding that
schema (`<scope>/<entry>`). Nothing in it names a machine path.

The report is one of the check's outputs: a check or build whose inputs
are unchanged runs again when the report is missing or unreadable.

`lucent sdk lock` checks the project and copies that record to
`lucent-sdk.lock.json`, which the app commits. It fails, writing
nothing, when a platform the project has code for has no SDK, unless
`--platforms` leaves that platform out. The lock's targets must be
platforms Lucent knows. `--frozen` builds and checks read it, skip the
build caches, and stop:

- when a target the lock lists has no SDK, or when the build would skip
  it (Android dependencies left to the Gradle build), instead of
  skipping it with a warning (the untyped `lucent:<platform>/*` stubs
  stay for editors and plain builds only);
- before the check, when a used or locked module is read from other
  artifacts than recorded, or is not recorded;
- after the check, when the code uses symbols the lock does not record.

`lucent sdk diff` finds each locked symbol in the installed SDK by native
symbol or by name and signature, then by name alone when one member of
that name is left (a JVM descriptor changes with the signature; not for
constructors, whose signature tells overloads apart). A member is looked
for under its owner as found again, so a member an extension gives
several types never answers for another type's; each installed symbol
answers for one locked symbol. It reports it removed, or changed with
what changed:
signature, native symbol, owner, TypeScript name, static-ness, `since`,
deprecation, enum cases. `--all` diffs every member of the used modules,
reading the locked schemas back from this machine's SDK cache
(`cachedSchema`) when it still holds them.

### Pending actions

The record's `pendingActions`, also `actions` in `lucent build --json`,
say what the app needs after the build (`src/cli/changes.ts`). They come
from what the build changed in the native package, never from a source
file's extension:

| Changed                                                                                               | Action                                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `js/` proxies                                                                                         | `reload-js`                                       |
| `cpp/`, `ios/`, generated Java; a package's `nativeSources`                                           | `compile-native` (the targets whose code changed) |
| a package's `resources`, `resourceBundles`, `assets`                                                  | `repackage`                                       |
| the podspec, `android/` build files; a package's `libraries`, `nativeLibraries`, `vendoredFrameworks` | `relink`                                          |
| the library manifest; `Info.plist` entries or entitlements in `resolved.json`                         | `reinstall`                                       |
| a file added or removed that iOS builds                                                               | `relink` on iOS (pod install lists files)         |
| `types/`, `manifest.json`, `js/_lucent/identity.js` (it changes with the generated code)              | nothing                                           |

A package's file is classified by the field that lists it, in the resolved
manifest of this build or the last. An unknown output relinks. Each action
has its targets and files; `requiredAction` (the single action of
C-BUILD v1) stays as it was.

The native package is published file by file through a temporary file
renamed over the old one, so Metro never reads half a proxy, and
`manifest.json`, Metro's cache key, comes last. Unchanged files keep their
content and mtime.

### Watching

`lucent dev` (and Metro's watcher, which runs it) watches the app and every
Lucent package whose directory is outside it (workspace or linked
packages), whole. A change rebuilds when a build reads the file: a module,
a `package.json` or `lucent.json`, or a path a package lists (the build's
`nativeInputs`). Dependencies and dot directories, where builds write, are
never read, so a build never triggers another; nor does an event for a
file last changed before the last build started. Saves are debounced; a
change during a build aborts it (`BuildOptions.signal`) before it writes,
and one build follows.

Resolving the Android classpath runs Gradle once at a time: the run holds
`.lucent/gradle.lock`, and another build waits for it and uses what it
resolved for the same inputs. The Gradle run gets `LUCENT_GRADLE_CLASSPATH`,
as the app's own `lucentBuild` task sets it, so no lucent build inside a
Gradle build launches Gradle again; such a build records the classpath's
inputs, so later builds reuse it. That Gradle build configured the Lucent
Android library before `lucentBuild` ran: when the build changes the
library's `build.gradle` (its first Kotlin shim, a package's Android
dependency), it writes the new file and fails, asking for another build,
rather than letting Gradle build the library as it was. A build that
leaves Android to the Gradle build (`expo prebuild`, which runs no
Gradle) cannot tell whether Android needs Kotlin shims, or Compose for
components' content while views are generated, so it writes the library
configured for them; a Gradle build that configured it so builds
whatever Android turns out to need, and the next one gets the exact file.
That build's autolinking also reads the package's component descriptors
before its `lucentBuild` compiles Android, so a deferred build lists every
component it describes (each is a component on every platform) and the
header including their descriptors, which that `lucentBuild` then writes
before CMake compiles anything.

## Editor diagnostics

`@lucent-lang/lucent/ts-plugin` is a TypeScript language-service plugin. tsserver
loads it with `require()` and its own `typescript`, which may be a different
version from the compiler's; the lowering matches on `ts.SyntaxKind`, so the
plugin never hands the editor's AST to the compiler. It `import()`s the
compiler (an ES module) asynchronously, refreshes diagnostics once loaded, and
calls `checkSources(files, readSource, { extensions })` with the project's
`*.lucent.ts` paths, the editor's unsaved buffer text and the Lucent
packages' native extensions, bound once per session (`projectExtensions`). The compiler builds its own program
(library declarations are parsed once per process) and returns diagnostics
with offsets and lengths. One check serves every file until a Lucent source
changes version. TypeScript errors are left to TypeScript.

## Tests

See [testing.md](testing.md).
