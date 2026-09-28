// Lucent runtime — `===`, loose `==` and SameValueZero.
//
// Each type's `strictEquals` (and `toJsString`) is declared at namespace
// scope, next to the type (array.h, map.h, bytes.h, …), never as a hidden
// friend: generated code calls `lucent::strictEquals` qualified, and
// qualified lookup does not see hidden friends.
//
// Operands may have different C++ types: TypeScript allows comparing types
// that overlap, and a generic instantiated with an object type still
// compares it with `undefined` or `0`. Optionals and unions compare what
// they hold; class instances compare as objects; any other pair of
// different types holds no common JavaScript value, so it is never equal.
#pragma once

#include <cmath>
#include <tuple>
#include <type_traits>
#include <variant>

#include "core.h"
#include "jsstring.h"

namespace lucent {

namespace detail {

template <class T>
struct TupleArity : std::integral_constant<int, -1> {};
template <class... Ts>
struct TupleArity<std::tuple<Ts...>> : std::integral_constant<int, sizeof...(Ts)> {};

/// Types whose values another C++ type can also hold: an optional's or a
/// union's (they compare what they hold).
template <class T>
inline constexpr bool holdsOthers = IsOpt<T>::value || IsVariant<T>::value;

/// Numbers of two C++ types compare as numbers (by conversion), not as
/// different types.
template <class T>
inline constexpr bool numeric = std::is_arithmetic_v<T> && !std::is_same_v<T, bool>;

}  // namespace detail

/// No JavaScript value is both an A and a B. Excluded, because they may be
/// one value: one type (its own overload), optionals and unions (they
/// compare what they hold), two class instances (one object seen through
/// a base class), two tuples of one length (element by element), and two
/// numeric types (one number).
template <class A, class B>
concept Disjoint = !std::is_same_v<A, B> && !detail::holdsOthers<A> && !detail::holdsOthers<B> &&
                   !(IsRef<A>::value && IsRef<B>::value) &&
                   !(detail::TupleArity<A>::value >= 0 && detail::TupleArity<A>::value == detail::TupleArity<B>::value) &&
                   !(detail::numeric<A> && detail::numeric<B>);

/// A number and a bigint, null and undefined, an array and `0`: never `===`.
template <class A, class B>
  requires Disjoint<A, B>
constexpr bool strictEquals(const A&, const B&) {
  return false;
}

inline bool strictEquals(double a, double b) { return a == b; }
inline bool strictEquals(bool a, bool b) { return a == b; }
inline bool strictEquals(const String& a, const String& b) { return a == b; }
inline bool strictEquals(Undefined, Undefined) { return true; }
inline bool strictEquals(Null, Null) { return true; }

template <class A, class B>
bool strictEquals(const Ref<A>& a, const Ref<B>& b) {
  return static_cast<const void*>(a.get()) == static_cast<const void*>(b.get());
}

template <class A, class B>
bool strictEquals(const Opt<A>& a, const Opt<B>& b) {
  if (a.has() && b.has()) return strictEquals(a.get(), b.get());
  return a.isUndefined() == b.isUndefined() && a.isNull() == b.isNull();
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
template <class T, class U>
  requires(!IsOpt<U>::value && !IsAbsent<U>)
bool strictEquals(const Opt<T>& a, const U& b) {
  return a.has() && strictEquals(a.get(), b);
}
template <class T, class U>
  requires(!IsOpt<U>::value && !IsAbsent<U>)
bool strictEquals(const U& b, const Opt<T>& a) {
  return a.has() && strictEquals(b, a.get());
}

/// Unions compare the members they hold, so members of different types
/// meet the rules above (`number | string` against `string | boolean`).
template <class... As, class... Bs>
bool strictEquals(const std::variant<As...>& a, const std::variant<Bs...>& b) {
  return std::visit([](const auto& x, const auto& y) { return strictEquals(x, y); }, a, b);
}
template <class... Ts, class U>
  requires(!IsOpt<U>::value && !IsVariant<U>::value)
bool strictEquals(const std::variant<Ts...>& a, const U& b) {
  return std::visit([&](const auto& x) { return strictEquals(x, b); }, a);
}
template <class... Ts, class U>
  requires(!IsOpt<U>::value && !IsVariant<U>::value)
bool strictEquals(const U& a, const std::variant<Ts...>& b) {
  return std::visit([&](const auto& y) { return strictEquals(a, y); }, b);
}

/// `x == null`: true for undefined and null, false for any present value.
template <class T>
bool looseEqualsNull(const T&) {
  return false;
}
inline bool looseEqualsNull(Undefined) { return true; }
inline bool looseEqualsNull(Null) { return true; }
template <class T>
bool looseEqualsNull(const Opt<T>& a) {
  return !a.has();
}

/// Loose `==` differs from `===` only for null and undefined in Lucent's
/// typed world (the compiler refuses the comparisons JavaScript converts).
template <class A, class B>
bool looseEquals(const A& a, const B& b) {
  return strictEquals(a, b) || (looseEqualsNull(a) && looseEqualsNull(b));
}

namespace detail {

/// Whether `v` holds NaN, where SameValueZero differs from `===`.
template <class T>
bool holdsNaN(const T& v) {
  if constexpr (std::is_floating_point_v<T>) return std::isnan(v);
  return false;
}
template <class T>
bool holdsNaN(const Opt<T>& v) {
  return v.has() && holdsNaN(v.get());
}
template <class... Ts>
bool holdsNaN(const std::variant<Ts...>& v) {
  return std::visit([](const auto& x) { return holdsNaN(x); }, v);
}

}  // namespace detail

/// SameValueZero (includes, Map and Set keys): `===`, but NaN is NaN.
template <class A, class B>
bool sameValueZero(const A& a, const B& b) {
  return strictEquals(a, b) || (detail::holdsNaN(a) && detail::holdsNaN(b));
}

}  // namespace lucent
