import type { Block, DocFrontmatter } from "../../types";
import { lucentJsonFields } from "../../../generated/lucent-json";

/**
 * The `extensions` field of lucent.json: its fields come from the schema,
 * as packages/lucent-json's do, and the rules of the module Lucent code
 * gets are written here.
 */
export const frontmatter: DocFrontmatter = {
  title: "Native extensions",
  description:
    "What an `extensions` declaration in `lucent.json` accepts, and what the `lucent:ext/<name>` module it makes gives Lucent code.",
  kind: "reference",
};

const fields = lucentJsonFields.filter((f) => f.field.startsWith("extensions."));

export const blocks: Block[] = [
  {
    kind: "p",
    text: "A native extension binds a C or C++ header a package ships. [Wrap a C library](/docs/packages/wrap-a-c-library/) shows a whole one; this page holds the rules.",
  },
  { kind: "h2", text: "Fields" },
  {
    kind: "table",
    head: ["Field", "Type", "Required", "Meaning"],
    rows: fields.map(({ field, type, required, description }) => [
      `\`${field}\``,
      `\`${type}\``,
      required ? "yes" : "",
      description,
    ]),
  },
  { kind: "h2", text: "What Lucent code gets" },
  {
    kind: "list",
    items: [
      "Each handle becomes a class of `lucent:ext/<name>`: `create` is its constructor, and `methods` are its methods.",
      "`close()` and `[Symbol.dispose]()` destroy a handle once, and so does its last reference going. A use after that throws an `InvalidStateError`.",
      "Integers wider than 32 bits (`long`, `size_t`, `int64_t` and their unsigned forms) are bigints. Other integers are numbers, checked on the way in as WebIDL's `[EnforceRange]` does.",
      "A `bytes` parameter takes a `Uint8Array`, an `ArrayBuffer` or a `NativeBuffer`, and C gets its own bytes, uncopied. A `NativeBuffer` is borrowed for the call, to read or to write, and a borrow that conflicts throws an `InvalidStateError`.",
      "A handle can't cross to JavaScript ([LUCENT2006](/docs/api/diagnostics/#lucent2006)): a Lucent class keeps it and publishes what JavaScript needs.",
      "The declarations editors read are written to `.lucent/native/types/ext/<name>.d.ts`.",
    ],
  },
  { kind: "h2", text: "How the header is read" },
  {
    kind: "list",
    items: [
      'The header lives in a directory both `ios.nativeSources` and `android.nativeSources` list. A C header compiles as C and as C++, declaring its functions in `extern "C"` when C++ includes it.',
      "`lucent build` reads it with clang: `$LUCENT_CLANG`, else `clang` on the `PATH`, else Xcode's, else the newest Android NDK's.",
      "A name or shape the declaration uses that the header doesn't have fails the build, naming the field.",
      "A function whose parameters are only numbers and booleans is bound without a declaration. One that takes a handle must be named, in `functions` or as a method.",
      "A function pointer is bound only as a declared callback. A variadic function or a struct passed by value can't be bound. The generated declarations list each one at the end, with the reason.",
    ],
  },
  { kind: "h2", text: "Callbacks" },
  {
    kind: "p",
    text: 'A function pointer parameter is a callback when `params` declares it one: `{ "callback": { "context": "ctx" } }`. Lucent code passes a function for it, and nothing for its context.',
  },
  {
    kind: "list",
    items: [
      "`context` names the function's `void *` parameter. C passes it back as the callback's one `void *` parameter, wherever that is.",
      "A callback takes numbers, bigints, booleans and `const char *` strings, copied (a null one is empty). It returns nothing, a number, a bigint or a boolean.",
      '`lives` says how long C may call it. `"call"`, the default, is until the function returns, and `"once"` until its first call. A handle parameter\'s name is until that handle\'s destroy function has returned.',
      "A call after a callback stopped living does nothing, and C gets zero.",
      "A callback runs on the context its call ran on. Called on a thread running that context's code, during the call or a later one, it runs at once, as a JavaScript callback does.",
      "Called from any other thread, it is posted to that context and runs in the order C called it. One that returns a value is refused there instead: C gets zero, and the call throws.",
      "What a callback throws doesn't unwind through C: C gets zero, and the extension call running on that thread throws it once C returns. Posted, it is reported as an uncaught error.",
    ],
  },
  { kind: "h2", text: "Cancelling a call" },
  {
    kind: "p",
    text: 'A `const volatile bool *` parameter is the call\'s signal when `params` declares it `{ "signal": "flag" }`. In C++, a member\'s `const std::atomic<bool> &` parameter is one, with no declaration.',
  },
  {
    kind: "list",
    items: [
      "Lucent code passes an `AbortSignal` for it, or leaves it out when it is last. C polls the flag while the call runs, and may not keep the pointer.",
      "Another thread sets the flag, so C reads it with an atomic load where its compiler has one: `__atomic_load_n(stop, __ATOMIC_ACQUIRE)` in clang and GCC.",
      "The flag turns true as soon as the signal aborts, on whichever thread aborts it, even while the call holds the signal's context.",
      "A signal aborted before the call throws its reason, and no call is made. One that aborts during the call throws its reason once the call returns, whatever C returned.",
    ],
  },
  { kind: "h2", text: "C++ headers" },
  {
    kind: "list",
    items: [
      'With `"language": "c++"`, the header is read as C++20 alone. Its functions with C linkage are bound as a C header\'s are.',
      "Each class the header defines, in a named namespace or none, is a class of `lucent:ext/<name>` under its own name. Its public constructors, member functions and static member functions are its constructor, methods and static methods.",
      "A parameter with a default argument gives an overload without it. Two overloads TypeScript can't tell apart, such as an `int` and a `double` parameter, are both left out.",
      "`std::string`, `std::string_view` and `const char *` are strings, and a `std::vector` of numbers, booleans or strings is an array. A `std::optional<T>` is `T | undefined`, and an enum is a TypeScript enum with its enumerators' values.",
      "A bound class is passed by reference or pointer, as the handle's object. Returned by value, it is a new handle, which deletes the object once.",
      "What C++ throws is an Error in Lucent: `what()` for a `std::exception`, or a message saying the call threw. No C++ exception unwinds through Lucent.",
      "Class templates, member templates, classes with a base and abstract classes aren't bound. Neither is a member taking or giving another type, or a pointer or reference result. The declarations list each, with the reason.",
      "A `std::function` parameter, by value or `const &`, is a callback, run as a C function's is. It lives as long as C++ keeps a copy of it. Two overloads differing only in their callbacks are both left out.",
      "`classes.<Name>.affinity` sets a class's thread, as `handles.<Name>.affinity` sets a handle's.",
    ],
  },
  { kind: "h2", text: "Errors and threads" },
  {
    kind: "list",
    items: [
      "A call whose `failsWhen` holds throws an Error with the error struct's message and code.",
      "An exception escaping a C header's function ends the process: catch it in the C++ and report it through the error struct. A C++ header's calls catch it themselves.",
      "A call holds its handles: a `close()` from another thread while it runs destroys the handle when the call returns.",
      "A call is cancelled through its signal's flag, which C reads: a function blocked elsewhere notices it only when it next looks.",
    ],
  },
];
