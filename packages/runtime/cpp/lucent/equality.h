// Lucent runtime — `===` and SameValueZero.
#pragma once

#include <cmath>
#include <variant>

#include "core.h"
#include "jsstring.h"

namespace lucent {

inline bool strictEquals(double a, double b) { return a == b; }
inline bool strictEquals(bool a, bool b) { return a == b; }
inline bool strictEquals(const String& a, const String& b) { return a == b; }
inline bool strictEquals(Undefined, Undefined) { return true; }
inline bool strictEquals(Null, Null) { return true; }

template <class A, class B>
bool strictEquals(const Ref<A>& a, const Ref<B>& b) {
  return static_cast<const void*>(a.get()) == static_cast<const void*>(b.get());
}

template <class T>
bool strictEquals(const Opt<T>& a, const Opt<T>& b) {
  if (a.state() != b.state()) return false;
  return !a.has() || strictEquals(a.get(), b.get());
}
template <class T>
bool strictEquals(const Opt<T>& a, Undefined) {
  return a.isUndefined();
}
template <class T>
bool strictEquals(const Opt<T>& a, Null) {
  return a.isNull();
}
template <class T>
bool strictEquals(Undefined, const Opt<T>& a) {
  return a.isUndefined();
}
template <class T>
bool strictEquals(Null, const Opt<T>& a) {
  return a.isNull();
}
template <class T, class U, std::enable_if_t<!IsOpt<U>::value && !std::is_same_v<U, Undefined> && !std::is_same_v<U, Null>, int> = 0>
bool strictEquals(const Opt<T>& a, const U& b) {
  return a.has() && strictEquals(a.get(), b);
}
template <class T, class U, std::enable_if_t<!IsOpt<U>::value && !std::is_same_v<U, Undefined> && !std::is_same_v<U, Null>, int> = 0>
bool strictEquals(const U& b, const Opt<T>& a) {
  return a.has() && strictEquals(b, a.get());
}

template <class... Ts>
bool strictEquals(const std::variant<Ts...>& a, const std::variant<Ts...>& b) {
  if (a.index() != b.index()) return false;
  return std::visit(
      [&](const auto& x) {
        using X = std::decay_t<decltype(x)>;
        return strictEquals(x, std::get<X>(b));
      },
      a);
}
template <class... Ts, class U, std::enable_if_t<!IsOpt<U>::value, int> = 0>
bool strictEquals(const std::variant<Ts...>& a, const U& b) {
  if (const U* p = std::get_if<U>(&a)) return strictEquals(*p, b);
  return false;
}

/// Loose `==` only differs from `===` for null/undefined in Lucent's typed
/// world: `x == null` is true for both absent states.
template <class T>
bool looseEqualsNull(const Opt<T>& a) {
  return !a.has();
}

inline bool sameValueZero(double a, double b) { return a == b || (std::isnan(a) && std::isnan(b)); }
template <class A, class B>
bool sameValueZero(const A& a, const B& b) {
  return strictEquals(a, b);
}
template <class T>
bool sameValueZero(const Opt<T>& a, const Opt<T>& b) {
  if (a.state() != b.state()) return false;
  return !a.has() || sameValueZero(a.get(), b.get());
}

}  // namespace lucent
