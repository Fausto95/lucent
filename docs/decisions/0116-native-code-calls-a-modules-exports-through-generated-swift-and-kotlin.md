# 0116. Native code calls a module's exports through generated Swift and Kotlin

- **Date:** 2026-10-15
- **Status:** accepted; extends
  [0091](0091-entry-points-are-c-functions-named-for-their-export.md)

The decision [T114](../tasks.md#t114) starts with: which exports Swift,
Kotlin and C++ code the app or a library ships can call, and the API each
sees. Every API wraps the C entry points of 0091, so a call runs as an
entry's does: a `NativeCall` on the module's actor, a synchronous one on
the calling thread (a main-thread entry there), an `async` one completing
from the module's context.

- **Which exports.** Each exported function and class of the program's
  modules whose types cross without JavaScript, with no mark: an export is
  how a module names something for code outside it. A generic function,
  or one with optional or rest parameters, gets none, as with entries.
- **What crosses.** 0091's numbers, booleans, `bigint`, strings, bytes and
  nothing; then `T | null` as an optional, arrays, `Record<string, T>`,
  platform objects as their SDK class, and instances of exported classes.
  A function, a JavaScript value or a plain object type still gives the
  export no native API.
- **Instances.** An exported class has a constructor entry, an entry per
  public method and property, and a release. Native code holds an
  instance through a wrapper, which holds its module state while it lives,
  as an OS-made class does
  ([0097](0097-exported-classes-extending-android-classes-are-os-made.md)).
  An instance crossing back gives the wrapper's instance.
- **C and C++.** `lucent_entries.h` as 0091 has it, the instance entries
  taking and giving an opaque `lucent_object`.
- **Swift.** A file in `LucentNative`, the pod's Swift module, gives each
  module a `public enum` named from its path in upper camel case
  (`lucent-sync/workers` is `LucentSyncWorkers`). Its functions are static
  methods that `throw`, `async` ones `async throws`, and its classes are
  nested `public final class`es. A throw is `LucentError`, with the
  Lucent error's `name`, `message` and `code`.
- **Kotlin.** A file per module in the generated library, in the package
  OS-made classes use (`dev.lucent.app.<module>`, 0097). Its functions
  are top-level, in a file Java sees as `Exports`; `async` ones are
  `suspend`. Its classes are classes of that package. A throw is a
  `LucentException` with the same three fields. JNI calls the entries.
- **Names.** Native names are the TypeScript ones. Two modules whose Swift
  names come out the same get no Swift API, with a warning, as entries do
  ([0094](0094-exports-that-would-share-an-entry-point-get-none.md)).

_Why:_ Swift, Kotlin and C++ are what Nitro's and Expo's native callers
write, and C entries are what each of them can call. Wrapping the entries
keeps one path into module code, with one set of argument checks, and
gives each language its own errors and async form. Names from the module's
path and the export's last as long as the TypeScript does.
_Changed:_ [native-platform.md](../design/native-platform.md#open-decisions)'s
second open question, now decided for the Swift and Kotlin APIs.
