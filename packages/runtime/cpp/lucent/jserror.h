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
  /// Class name when a Lucent class extends Error, for `instanceof`.
  const char* kind = "Error";
};
using Error = Ref<ErrorObject>;

Error makeError(const String& name, const String& message);
inline Error makeError(const String& message) { return makeError(String::fromLatin1("Error"), message); }

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

/// Converts whatever is being caught into a Lucent Error, including C++
/// exceptions from the standard library.
Error currentError(std::exception_ptr ex);

String errorToString(const Error& e);

}  // namespace lucent
