# 0125. A C++ header's classes are handles, which the generated C++ calls

- **Date:** 2026-10-16
- **Status:** accepted

How a native extension wraps a C++ library, as a Nitro C++ Hybrid Object
does ([T142](../tasks.md#t142)'s first items).

- **Declaration.** `extensions.<name>.language` is `"c"`, the default, or
  `"c++"`. A C++ header is read as C++20 alone, by the clang a C header is
  read with, and it must compile without the extension's sources. Its
  functions with C linkage are bound as a C header's are, and the
  declaration's `handles`, `functions` and `errors` mean what they do for
  C.
- **Classes.** Each class or struct the header itself defines, in a named
  namespace or none, is a handle class of `lucent:ext/<name>`, under its
  own name. Its public constructors are its constructor's overloads, its
  public member functions (`const` or not) its methods, and its static
  member functions its static methods. A parameter with a default argument
  gives an overload without it, and the ones after it. Copy and move
  constructors, operators, conversions and destructors aren't bound. The
  handle owns the object it made: `close()`, or its last reference going,
  deletes it once. `classes.<Name>.affinity` gives the class's thread, as
  a C handle's `affinity` does, and a main-thread class's members run
  there.
- **Types.** Booleans, integers and floating-point numbers cross as a C
  header's do. `std::string`, `std::string_view` and `const char *` are
  strings, copied at the call. A `std::vector` of numbers, booleans or
  strings is an array, and a `std::optional<T>` is `T | undefined`. An enum,
  scoped or not, is a TypeScript enum of the module with its enumerators'
  values. A bound class, by `const T &`, `T &` or `T *`, is its handle's
  object, which the call holds. Returned by value, it is a new handle,
  moved into one.
- **Left out.** Class templates, member templates, classes with a base and
  abstract classes are not bound, nor is a member whose types are none of
  these: a pointer or reference to anything else, another template, a
  callback. Two overloads that TypeScript can't tell apart (an `int` and a
  `double` parameter, both numbers) are left out together. Two classes
  with one name in different namespaces get neither. Each is listed with
  its reason in the declarations' list of what was left out, as a C
  header's are.
- **Exceptions.** Each call of a class's member is made inside a
  `try`, so no C++ exception unwinds through Lucent's frames. One deriving
  from `std::exception` throws an `Error` in Lucent with its `what()`;
  anything else throws an `Error` that says a C++ exception was thrown. A C
  function of a C++ header is called the same way.

_Why:_ the code Lucent generates is C++ already, so it can construct and
call the classes themselves, with their own types, where a C shim would
add a second set of declarations to keep in step and lose the overloads.
A class's members are what its header says, so nothing has to be declared
to bind them; only what C++ can't say (a class's thread) is declared.
Catching at the call keeps Lucent's frames free of foreign exceptions,
which a C interface did by ending the process. _Limits:_ callbacks and
cancellation are T142's next items; inheritance, templates and public
data members wait for a package that needs them. _Changed:_ the C-EXT
contract's planned C++ support (a wrapper catching exceptions into the
error struct becomes the call's own `try`).
