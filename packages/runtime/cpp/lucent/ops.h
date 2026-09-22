// Lucent runtime — generic operations the compiler emits: truthiness,
// string conversion, typeof, and conversions between union representations.
#pragma once

#include <cmath>
#include <variant>

#include "array.h"
#include "async.h"
#include "bytes.h"
#include "core.h"
#include "error.h"
#include "function.h"
#include "map.h"
#include "number.h"
#include "string.h"

namespace lucent {

// --- truthiness ----------------------------------------------------------
inline bool truthy(bool v) { return v; }
inline bool truthy(double v) { return v != 0 && !std::isnan(v); }
inline bool truthy(const String& s) { return !s.empty(); }
inline bool truthy(Undefined) { return false; }
inline bool truthy(Null) { return false; }
template <class T>
bool truthy(const Ref<T>& r) {
  return r != nullptr;
}
template <class T>
bool truthy(const Opt<T>& v) {
  return v.has() && truthy(v.get());
}
template <class... Ts>
bool truthy(const std::variant<Ts...>& v) {
  return std::visit([](const auto& x) { return truthy(x); }, v);
}
template <class T>
bool truthy(const T&) {
  return true;  // arrays, maps, functions, promises, bytes: objects are truthy
}

// --- String(x) -------------------------------------------------------------
template <class T, std::enable_if_t<std::is_base_of_v<Object, T> && !std::is_base_of_v<ErrorObject, T>, int> = 0>
String toJsString(const Ref<T>&) {
  return String::fromLatin1("[object Object]");
}
inline String toJsString(const Error& e) { return errorToString(e); }
template <class Sig>
String toJsString(const Fn<Sig>&) {
  return String::fromLatin1("function () { [native code] }");
}
template <class... Ts>
String toJsString(const std::variant<Ts...>& v) {
  return std::visit([](const auto& x) { return toJsString(x); }, v);
}

// --- typeof -----------------------------------------------------------------
inline String typeOf(double) { return String::fromLatin1("number"); }
inline String typeOf(bool) { return String::fromLatin1("boolean"); }
inline String typeOf(const String&) { return String::fromLatin1("string"); }
inline String typeOf(Undefined) { return String::fromLatin1("undefined"); }
inline String typeOf(Null) { return String::fromLatin1("object"); }
template <class Sig>
String typeOf(const Fn<Sig>&) {
  return String::fromLatin1("function");
}
template <class T>
String typeOf(const Opt<T>& v) {
  if (v.isUndefined()) return String::fromLatin1("undefined");
  if (v.isNull()) return String::fromLatin1("object");
  return typeOf(v.get());
}
template <class... Ts>
String typeOf(const std::variant<Ts...>& v) {
  return std::visit([](const auto& x) { return typeOf(x); }, v);
}
template <class T>
String typeOf(const T&) {
  return String::fromLatin1("object");
}

// --- unions -------------------------------------------------------------------
template <class T>
struct IsVariant : std::false_type {};
template <class... Ts>
struct IsVariant<std::variant<Ts...>> : std::true_type {};

template <class T, class V>
constexpr bool variantHolds() {
  if constexpr (IsVariant<V>::value) {
    return []<class... Ts>(std::variant<Ts...>*) { return (std::is_same_v<T, Ts> || ...); }(static_cast<V*>(nullptr));
  } else {
    return false;
  }
}

/// Converts between value representations the type checker has proven
/// compatible: member → union, union → wider union, union → narrower union,
/// union → member (after narrowing), and T ↔ Opt<T>.
template <class To, class From>
To convert(From&& from);

namespace detail {
template <class To, class From>
To convertImpl(const From& from) {
  using F = std::decay_t<From>;
  if constexpr (std::is_same_v<To, F>) {
    return from;
  } else if constexpr (IsOpt<To>::value) {
    using Inner = typename To::ValueType;
    if constexpr (IsOpt<F>::value) {
      if (from.isUndefined()) return To(undefined);
      if (from.isNull()) return To(null);
      return To(convert<Inner>(from.get()));
    } else if constexpr (std::is_same_v<F, Undefined>) {
      return To(undefined);
    } else if constexpr (std::is_same_v<F, Null>) {
      return To(null);
    } else {
      return To(convert<Inner>(from));
    }
  } else if constexpr (IsOpt<F>::value) {
    // Proven present by narrowing; still checked.
    return convert<To>(from.value());
  } else if constexpr (IsVariant<F>::value) {
    return std::visit(
        [](const auto& x) -> To {
          using X = std::decay_t<decltype(x)>;
          if constexpr (std::is_same_v<X, To> || std::is_constructible_v<To, X>) {
            if constexpr (IsVariant<To>::value && !variantHolds<X, To>()) {
              throwTypeError("Value does not match the expected union member");
            } else {
              return To(x);
            }
          } else {
            throwTypeError("Value does not match the expected type");
          }
        },
        from);
  } else if constexpr (IsVariant<To>::value) {
    return To(from);
  } else {
    return To(from);
  }
}
}  // namespace detail

template <class To, class From>
To convert(From&& from) {
  return detail::convertImpl<To>(from);
}

/// Narrows a union to one member; the checker proved it holds.
template <class T, class... Ts>
const T& narrow(const std::variant<Ts...>& v) {
  if (const T* p = std::get_if<T>(&v)) return *p;
  throwTypeError("Value does not match the narrowed type");
}
template <class T, class... Ts>
bool holds(const std::variant<Ts...>& v) {
  return std::holds_alternative<T>(v);
}

}  // namespace lucent
