#include "error.h"

#include <new>
#include <stdexcept>

namespace lucent {

Error makeError(const String& name, const String& message) {
  auto e = std::make_shared<ErrorObject>();
  e->name = name;
  e->message = message;
  return e;
}

Exception::Exception(Error error) : error_(std::move(error)) {
  what_ = error_->name.toUtf8() + ": " + error_->message.toUtf8();
}

void throwError(const Error& error) { throw Exception(error); }

void throwError(const String& name, const String& message) { throw Exception(makeError(name, message)); }

void throwTypeError(const char* message) {
  throwError(String::fromLatin1("TypeError"), String::fromUtf8(message));
}

void throwRangeError(const char* message) {
  throwError(String::fromLatin1("RangeError"), String::fromUtf8(message));
}

Error currentError(std::exception_ptr ex) {
  try {
    std::rethrow_exception(ex);
  } catch (const Exception& e) {
    return e.error();
  } catch (const std::bad_alloc&) {
    return makeError(String::fromLatin1("RangeError"), String::fromLatin1("Out of memory"));
  } catch (const std::exception& e) {
    return makeError(String::fromLatin1("Error"), String::fromUtf8(e.what()));
  } catch (...) {
    return makeError(String::fromLatin1("Error"), String::fromLatin1("Unknown native exception"));
  }
}

String errorToString(const Error& e) {
  if (e->message.empty()) return e->name;
  if (e->name.empty()) return e->message;
  return e->name + String::fromLatin1(": ") + e->message;
}

}  // namespace lucent
