// Lucent runtime — Error objects and exceptions.
//
// `throw new Error("x")` in Lucent throws a C++ `lucent::Exception` holding
// an ErrorObject. At the JavaScript boundary it becomes a real JS Error with
// the same name, message and `code`.
#pragma once

#include <exception>
#include <string>

#include "core.h"
#include "jsstring.h"

namespace lucent {

struct ErrorObject : Object {
  String name;
  String message;
  Opt<String> code;
  /// For errors that came from JavaScript: the original stack.
  Opt<String> stack;
  /// Where Lucent code created the error: `fn (file.lucent.ts:line)`.
  Opt<String> site;
  /// Class name when a Lucent class extends Error, for `instanceof`.
  const char* kind = "Error";
};
using Error = Ref<ErrorObject>;

Error makeError(const String& name, const String& message);
inline Error makeError(const String& message) { return makeError(String::fromLatin1("Error"), message); }

/// Records where Lucent code created `e` (generated code passes __FILE__ and
/// __LINE__, which #line directives point at the .lucent.ts source).
template <class E>
E withSite(E e, const char* file, int line, const char* function) {
  if (e && !e->site.has()) e->site = String::fromUtf8(std::string(function) + " (" + file + ":" + std::to_string(line) + ")");
  return e;
}

class Exception : public std::exception {
 public:
  explicit Exception(Error error);
  const Error& error() const { return error_; }
  const char* what() const noexcept override { return what_.c_str(); }

 private:
  Error error_;
  std::string what_;
};

[[noreturn]] void throwError(const Error& error);
[[noreturn]] void throwError(const String& name, const String& message);
/// A platform branch (`if (PLATFORM === "ios")`) reached on a target that is
/// neither platform, the host; typed as the value it stands for.
template <class T = void>
[[noreturn]] T platformOnly(const String& message) {
  throwError(String::fromLatin1("Error"), message);
}

/// Converts whatever is being caught into a Lucent Error, including C++
/// exceptions from the standard library.
Error currentError(std::exception_ptr ex);

String errorToString(const Error& e);

}  // namespace lucent
