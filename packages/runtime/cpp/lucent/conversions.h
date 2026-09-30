// Lucent runtime — Number(x) and BigInt(x) of a value whose type is a union
// (bigint | number, possibly absent, …): each alternative converted as
// JavaScript converts it. The compiler converts a value of one known type
// inline; these take the value as it is held (Opt, std::variant).
#pragma once

#include <compare>
#include <type_traits>
#include <variant>

#include "bigint.h"
#include "core.h"
#include "number.h"
#include "jsstring.h"

namespace lucent {

// --- Number(x) -------------------------------------------------------------------------

inline double toNumber(double x) { return x; }
inline double toNumber(bool x) { return x ? 1.0 : 0.0; }
inline double toNumber(const String& x) { return stringToNumber(x); }
/// The nearest double, ties to even.
inline double toNumber(const BigInt& x) { return x.toDouble(); }
inline double toNumber(Undefined) { return kNaN; }
inline double toNumber(Null) { return 0.0; }

template <class T>
double toNumber(const Opt<T>& x);
template <class... Ts>
double toNumber(const std::variant<Ts...>& x);

template <class T>
double toNumber(const Opt<T>& x) {
  if (x.isUndefined()) return kNaN;
  if (x.isNull()) return 0.0;

  return toNumber(x.get());
}

template <class... Ts>
double toNumber(const std::variant<Ts...>& x) {
  return std::visit([](const auto& v) { return toNumber(v); }, x);
}

// --- BigInt(x) -------------------------------------------------------------------------

inline BigInt toBigInt(const BigInt& x) { return x; }
/// A RangeError unless `x` is an integer.
inline BigInt toBigInt(double x) { return BigInt::fromDouble(x); }
/// A SyntaxError unless `x` is an integer literal.
inline BigInt toBigInt(const String& x) { return BigInt::parse(x); }
inline BigInt toBigInt(bool x) { return BigInt::fromInt64(x ? 1 : 0); }

template <class... Ts>
BigInt toBigInt(const std::variant<Ts...>& x) {
  return std::visit([](const auto& v) { return toBigInt(v); }, x);
}

// --- comparison ----------------------------------------------------------------------

/**
 * The order of two numeric values, each a number, a bigint, or a union of
 * them (`bigint | number`): exact across kinds, as JavaScript's relational
 * operators compare; unordered when either is NaN.
 */
template <class A, class B>
std::partial_ordering compareNumeric(const A& a, const B& b) {
  if constexpr (IsVariant<A>::value)
    return std::visit([&](const auto& x) { return compareNumeric(x, b); }, a);
  else if constexpr (IsVariant<B>::value)
    return std::visit([&](const auto& y) { return compareNumeric(a, y); }, b);
  else
    return a <=> b;
}

// --- unary operators on a number | bigint --------------------------------------------

/// `-x`, on the value's own kind.
template <class... Ts>
std::variant<Ts...> negateNumeric(const std::variant<Ts...>& x) {
  return std::visit([](const auto& v) -> std::variant<Ts...> { return -v; }, x);
}

/// `~x`: of a number, ~ToInt32; of a bigint, its own.
template <class... Ts>
std::variant<Ts...> bitNotNumeric(const std::variant<Ts...>& x) {
  return std::visit(
      [](const auto& v) -> std::variant<Ts...> {
        if constexpr (std::is_same_v<std::decay_t<decltype(v)>, double>)
          return static_cast<double>(~toInt32(v));
        else
          return ~v;
      },
      x);
}

/// `x + 1` (`step` 1) or `x - 1` (-1), for `++` and `--`, on the value's own kind.
template <class... Ts>
std::variant<Ts...> stepNumeric(const std::variant<Ts...>& x, int step) {
  return std::visit(
      [step](const auto& v) -> std::variant<Ts...> {
        if constexpr (std::is_same_v<std::decay_t<decltype(v)>, double>)
          return v + step;
        else
          return v + BigInt::fromInt64(step);
      },
      x);
}

}  // namespace lucent
