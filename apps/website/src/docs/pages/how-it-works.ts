import type { DocPage } from "../types";
import { demoCpp, demoSource } from "../../generated/compiler-demo";

export const page: DocPage = {
  slug: "how-it-works",
  title: "How it works",
  description: "How a Lucent module becomes C++ in your app binary, and how JavaScript reaches it.",
  blocks: [
    {
      kind: "p",
      text: "Lucent has two halves. At build time, a Node program compiles your `*.lucent.ts` files to C++ and writes a native package. At run time, that package is a C++ TurboModule your JavaScript calls through JSI. Nothing on the native side interprets JavaScript.",
    },
    { kind: "diagram", diagram: "pipeline", caption: "From a source file to the app binary." },
    { kind: "h2", text: "The compiler" },
    {
      kind: "p",
      text: "The front end is the real TypeScript compiler. Lucent builds a TypeScript program in strict mode with `noUncheckedIndexedAccess`, and takes every type from the checker, including narrowing (`typeof`, discriminants, `instanceof`, `!== undefined`). It never re-implements type inference, so a module that type-checks in your editor is checked the same way by `lucent build`.",
    },
    {
      kind: "p",
      text: "Lucent then lowers the checked program to C++20. Code outside the supported subset (`any`, `var`, and so on) stops the build with a diagnostic that has a stable `LUCENT` code and points at the source; see [diagnostics](/docs/language/diagnostics/).",
    },
    {
      kind: "tabs",
      tabs: [
        { label: "TypeScript", filename: "geo.lucent.ts", code: demoSource },
        { label: "Generated C++", filename: "m_geo.cpp", code: demoCpp },
      ],
    },
    { kind: "h3", text: "JavaScript semantics in C++" },
    {
      kind: "p",
      text: "The generated code behaves like the same TypeScript run as JavaScript. The test suite checks exactly that: each case runs natively through JSI and must print what the plain JavaScript prints.",
    },
    {
      kind: "list",
      items: [
        "`number` is a `double` with ECMAScript arithmetic, conversions and formatting. Locals that only ever hold integers (bitwise results, loop counters) are stored as integers, with the same results.",
        "`string` is an immutable UTF-16 string with a Latin-1 fast path.",
        "Objects, arrays, maps and class instances are reference-counted and shared, as in JavaScript. Object types become C++ structs, one per shape.",
        "`throw` and `try`/`catch`/`finally` are C++ exceptions with JavaScript's control flow.",
        "`async`/`await` and generators are C++20 coroutines.",
      ],
    },
    {
      kind: "p",
      text: "Where the two differ (reference counting does not free cycles, arrays have no holes), [differences from JavaScript](/docs/language/differences/) lists the cases.",
    },
    { kind: "h2", text: "The runtime" },
    {
      kind: "p",
      text: "The generated code is linked against a C++ runtime with no dependencies beyond the standard library and JSI. It implements strings, numbers, arrays, maps, promises, errors, `RegExp`, `JSON` and `Date` with JavaScript semantics, and the boundary: converting and validating arguments, keeping class instances' identity, calling JavaScript callbacks, and bridging promises in both directions.",
    },
    { kind: "diagram", diagram: "runtime", caption: "Where Lucent code runs when JavaScript calls it." },
    {
      kind: "p",
      text: "A synchronous export runs on the JS thread and returns directly. An `async` export starts on a separate Lucent thread and resolves its promise on the JS thread. One lock serializes all Lucent code, so it runs one piece at a time, like JavaScript. [Async](/docs/language/async/) covers the consequences.",
    },
    { kind: "h2", text: "One C++ TurboModule" },
    {
      kind: "p",
      text: "All of your modules are served by a single pure C++ TurboModule named `Lucent`. When JavaScript first asks for a module, it builds that module's exports object.",
    },
    {
      kind: "list",
      items: [
        "**iOS**: the package's podspec compiles the runtime and your modules, and the module registers itself in React Native's C++ TurboModule map at load time. There is no codegen step and no change to the app delegate.",
        "**Android**: the package is a pure C++ dependency. React Native's Gradle plugin adds its CMake project to the app's native build and instantiates the module through autolinking.",
      ],
    },
    {
      kind: "p",
      text: "Both the React Native CLI and Expo find the package through the `lucent-native` entry in `react-native.config.js`, which points at `.lucent/native`.",
    },
    { kind: "h2", text: "Metro proxies" },
    {
      kind: "p",
      text: "Your editor and `tsc` read the `.lucent.ts` source, so imports are fully typed. When Metro bundles the app, the `withLucent` transformer replaces each `*.lucent.ts` module with a generated proxy that loads the module from the `Lucent` TurboModule and re-exports its exports. None of the module's code ends up in the JS bundle.",
    },
    { kind: "h2", text: "What `.lucent/native` contains" },
    {
      kind: "table",
      head: ["Path", "Contents"],
      rows: [
        ["`cpp/lucent/`, `cpp/third_party/`", "The C++ runtime, copied from `@lucent-lang/runtime`."],
        ["`cpp/rn/`", "The `Lucent` TurboModule."],
        ["`cpp/generated/`", "Your modules: `lucent_app.h`, `m_<module>.h` and `m_<module>.cpp` per module, and `lucent_bindings.cpp` (the JSI bindings)."],
        ["`ios/`, `LucentNative.podspec`", "iOS registration and the CocoaPods spec."],
        ["`android/`", "The CMake project and the autolinking header."],
        ["`react-native.config.js`", "Declares the package as a pure C++ dependency."],
        ["`js/<module>.js`", "The proxies Metro bundles."],
        ["`manifest.json`", "The module list and a hash of the last build's inputs."],
      ],
    },
    {
      kind: "p",
      text: "The directory is generated: keep it out of version control and let `lucent build` rewrite it. With platform modules, the generated C++ is split into `generated/ios/` and `generated/android/`; see [platform APIs](/docs/platform-apis/).",
    },
    { kind: "h2", text: "Incremental builds" },
    {
      kind: "p",
      text: "`lucent build` hashes its inputs and returns immediately when nothing changed. Otherwise it rewrites only the files whose contents changed. Each module has its own header, so Xcode and Gradle recompile only the modules you edited and the modules that import them. While Metro's dev server runs, a watcher does this on every save.",
    },
    { kind: "h2", text: "Errors and crashes" },
    {
      kind: "p",
      text: "The generated C++ carries `#line` directives that map it back to your source. C++ compiler errors and debugger stepping point at `.lucent.ts` lines, and so does crash symbolication: with the app's dSYM (iOS) or unstripped `.so` (Android), a native crash in Lucent code symbolicates to the `.lucent.ts` file and line.",
    },
    {
      kind: "p",
      text: "Errors thrown in Lucent code record where they were created. When one reaches JavaScript, the top frame of its `stack` names the Lucent function, file and line. See [errors at the boundary](/docs/boundary/errors/).",
    },
  ],
};
