// Lucent runtime — ECMAScript number semantics.
#pragma once

#include <charconv>
#include <cmath>
#include <concepts>
#include <cstdint>
#include <limits>
#include <string>
#include <type_traits>

#include "jsstring.h"

namespace lucent {

inline constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
inline constexpr double kInfinity = std::numeric_limits<double>::infinity();

/// ECMAScript ToInt32.
inline int32_t toInt32(double v) {
  // One branch for every value int64 holds: int32 values, and the uint32
  // results of `>>> 0` alike, whatever their sign bit. (Two ranges, int32
  // then uint32, mispredict on data like CRC tables.) The conversion
  // truncates; narrowing wraps modulo 2^32, as ToInt32 does.
  if (v > -9223372036854775808.0 && v < 9223372036854775808.0) {
    return static_cast<int32_t>(static_cast<uint32_t>(static_cast<int64_t>(v)));
  }
  if (!std::isfinite(v)) return 0;
  double m = std::fmod(std::trunc(v), 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return static_cast<int32_t>(static_cast<uint32_t>(m));
}
inline uint32_t toUint32(double v) { return static_cast<uint32_t>(toInt32(v)); }

inline double jsMod(double a, double b) {
  // Exact integer operands with a positive divisor: an integer remainder,
  // keeping the dividend's sign (including -0) as JavaScript does.
  constexpr double kExact = 9007199254740992.0;  // 2^53
  if (a >= -kExact && a <= kExact && b >= 1.0 && b <= kExact) {
    auto ia = static_cast<int64_t>(a);
    auto ib = static_cast<int64_t>(b);
    if (static_cast<double>(ia) == a && static_cast<double>(ib) == b) {
      int64_t r = ia % ib;
      return r == 0 && std::signbit(a) ? -0.0 : static_cast<double>(r);
    }
  }
  return std::fmod(a, b);
}
inline double jsShl(double a, double b) { return static_cast<double>(static_cast<int32_t>(toUint32(a) << (toUint32(b) & 31))); }
inline double jsSar(double a, double b) { return static_cast<double>(toInt32(a) >> (toUint32(b) & 31)); }
inline double jsShr(double a, double b) { return static_cast<double>(toUint32(a) >> (toUint32(b) & 31)); }
inline double jsAnd(double a, double b) { return static_cast<double>(toInt32(a) & toInt32(b)); }
inline double jsOr(double a, double b) { return static_cast<double>(toInt32(a) | toInt32(b)); }
inline double jsXor(double a, double b) { return static_cast<double>(toInt32(a) ^ toInt32(b)); }
inline double jsNot(double a) { return static_cast<double>(~toInt32(a)); }
double jsPow(double a, double b);

/// Number.prototype.toString() / String(number).
String numberToString(double v);
String numberToString(double v, double radix);
String numberToFixed(double v, double digits);
String numberToPrecision(double v, double precision);
String numberToExponential(double v, double digits);
String numberToExponential(double v);
/// toPrecision(p) and toExponential(d) with an argument that may be
/// undefined: undefined is the argument left out, unlike NaN.
inline String numberToPrecision(double v, const Opt<double>& precision) {
  return precision.has() ? numberToPrecision(v, precision.get()) : numberToString(v);
}
inline String numberToExponential(double v, const Opt<double>& digits) {
  return digits.has() ? numberToExponential(v, digits.get()) : numberToExponential(v);
}
/// Number(string) / unary plus.
double stringToNumber(const String& s);
double parseFloat(const String& s);
double parseInt(const String& s);
double parseInt(const String& s, double radix);

inline String toJsString(double v) { return numberToString(v); }
inline String toJsString(bool v) { return String::fromLatin1(v ? "true" : "false"); }
inline String toJsString(const String& v) { return v; }
inline String toJsString(Undefined) { return String::fromLatin1("undefined"); }
inline String toJsString(Null) { return String::fromLatin1("null"); }

inline bool isInteger(double v) { return std::isfinite(v) && std::trunc(v) == v; }
inline bool isSafeInteger(double v) { return isInteger(v) && std::fabs(v) <= 9007199254740991.0; }
inline bool isFinite(double v) { return std::isfinite(v); }
inline bool isNaN(double v) { return std::isnan(v); }

[[noreturn]] void throwInexactInteger(const std::string& value);

/// A native integer (a 64-bit one: Int64, NSInteger, Java's long) as a
/// number, exactly: RangeError beyond +-(2^53 - 1), which a number cannot
/// tell apart from its neighbors. Never rounded.
template <class I>
  requires std::is_integral_v<I>
double exactNumber(I v) {
  constexpr uint64_t kMax = 9007199254740991;  // 2^53 - 1
  bool fits;
  if constexpr (std::is_signed_v<I>)
    fits = v >= -static_cast<int64_t>(kMax) && v <= static_cast<int64_t>(kMax);
  else
    fits = static_cast<uint64_t>(v) <= kMax;

  if (!fits) throwInexactInteger(std::to_string(v));
  return static_cast<double>(v);
}

/// A number as a native 64-bit integer, as WebIDL's [EnforceRange] long
/// long converts it: truncated toward zero; RangeError when it is not
/// finite or beyond what a number holds exactly (below 0 for unsigned).
template <class I>
  requires std::is_integral_v<I>
I toExactInteger(double v) {
  double t = std::trunc(v);
  double low = std::is_signed_v<I> ? -9007199254740991.0 : 0.0;
  if (!(t >= low && t <= 9007199254740991.0)) throwInexactInteger(numberToString(v).toUtf8());

  return static_cast<I>(t);
}

/// A number passed where native code takes a 64-bit integer (a Java long,
/// a Swift Int): a safe integer (Number.isSafeInteger), exactly, or
/// RangeError naming `what`, the parameter it is for. A bigint takes
/// toNativeInteger(const BigInt&) instead.
template <std::integral I>
  requires(!std::same_as<I, bool>)
I toNativeInteger(double v, const char* what) {
  double low = std::is_signed_v<I> ? -9007199254740991.0 : 0.0;
  if (std::trunc(v) == v && v >= low && v <= 9007199254740991.0) return static_cast<I>(v);
  throwRangeError((std::string(what) + ": " + numberToString(v).toUtf8() + " is not a safe integer").c_str());
}

/// A number as a narrower native number, as WebIDL's default conversion
/// (no [EnforceRange]): an integer of 32 bits or fewer takes ToInt32 and
/// wraps modulo 2^bits; a 64-bit one takes toExactInteger; an enum its
/// underlying type's; a floating type rounds.
template <class T>
T toNativeNumber(double v) {
  static_assert(!std::is_same_v<T, bool>, "a boolean is not a number");

  if constexpr (std::is_enum_v<T>)
    return static_cast<T>(toNativeNumber<std::underlying_type_t<T>>(v));
  else if constexpr (std::is_floating_point_v<T>)
    return static_cast<T>(v);
  else if constexpr (sizeof(T) <= 4)
    return static_cast<T>(toInt32(v));
  else
    return toExactInteger<T>(v);
}

namespace math {
inline double abs(double v) { return std::fabs(v); }
inline double floor(double v) { return std::floor(v); }
inline double ceil(double v) { return std::ceil(v); }
inline double trunc(double v) { return std::trunc(v); }
double round(double v);
inline double sign(double v) { return std::isnan(v) ? v : (v > 0 ? 1.0 : (v < 0 ? -1.0 : v)); }
inline double sqrt(double v) { return std::sqrt(v); }
/// fdlibm's cbrt (exact for perfect cubes, like JavaScript engines).
double cbrt(double v);
inline double exp(double v) { return std::exp(v); }
inline double expm1(double v) { return std::expm1(v); }
inline double log(double v) { return std::log(v); }
inline double log2(double v) { return std::log2(v); }
inline double log10(double v) { return std::log10(v); }
inline double log1p(double v) { return std::log1p(v); }
inline double sin(double v) { return std::sin(v); }
inline double cos(double v) { return std::cos(v); }
inline double tan(double v) { return std::tan(v); }
inline double asin(double v) { return std::asin(v); }
inline double acos(double v) { return std::acos(v); }
inline double atan(double v) { return std::atan(v); }
inline double atan2(double y, double x) { return std::atan2(y, x); }
inline double sinh(double v) { return std::sinh(v); }
inline double cosh(double v) { return std::cosh(v); }
inline double tanh(double v) { return std::tanh(v); }
inline double asinh(double v) { return std::asinh(v); }
inline double acosh(double v) { return std::acosh(v); }
inline double atanh(double v) { return std::atanh(v); }
inline double pow(double a, double b) { return jsPow(a, b); }
inline double fround(double v) { return static_cast<double>(static_cast<float>(v)); }
inline double imul(double a, double b) {
  return static_cast<double>(static_cast<int32_t>(toUint32(a) * toUint32(b)));
}
inline double clz32(double v) {
  uint32_t x = toUint32(v);
  if (x == 0) return 32;
  double n = 0;
  while (!(x & 0x80000000u)) {
    x <<= 1;
    n++;
  }
  return n;
}
double hypot(double a, double b);
double hypot(double a, double b, double c);
double random();
double min();
double max();
double min(double a);
double max(double a);
double min(double a, double b);
double max(double a, double b);
template <class... Rest>
double min(double a, double b, double c, Rest... rest) {
  return min(min(a, b), c, rest...);
}
template <class... Rest>
double max(double a, double b, double c, Rest... rest) {
  return max(max(a, b), c, rest...);
}
}  // namespace math

namespace detail {
/// One part of a concatenation: a string, or a number already formatted
/// into `digits`, so the total length is known before allocating.
struct ConcatPiece {
  const String* s = nullptr;
  String formatted;  // numbers without a short form (fractions, exponents)
  char digits[24];
  uint8_t n = 0;
  const String* string() const { return s ? s : formatted.empty() ? nullptr : &formatted; }
  size_t length() const { return string() ? string()->length() : n; }
  bool oneByte() const { return !string() || string()->isOneByte(); }
  void appendTo(StringBuilder& b) const {
    if (auto* str = string()) b.append(*str);
    else b.appendAscii(std::string_view(digits, n));
  }
};
void formatNumber(double v, ConcatPiece& out);

template <class P>
ConcatPiece concatPiece(const P& p) {
  ConcatPiece piece;
  if constexpr (std::is_floating_point_v<P>) {
    formatNumber(static_cast<double>(p), piece);
  } else if constexpr (std::is_arithmetic_v<P> && !std::is_same_v<P, bool>) {
    // Exact integers (from integer inference) print as their digits.
    auto r = std::to_chars(piece.digits, piece.digits + sizeof piece.digits, p);
    piece.n = static_cast<uint8_t>(r.ptr - piece.digits);
  } else {
    piece.s = &p;
  }
  return piece;
}
}  // namespace detail

/// A template literal: strings and numbers joined into one string, allocating
/// only the result.
template <class... P>
String concat(const P&... parts) {
  if constexpr (sizeof...(P) == 1 && (std::is_same_v<P, String> && ...)) {
    return (parts, ...);
  } else {
    detail::ConcatPiece pieces[] = {detail::concatPiece(parts)...};
    size_t length = 0;
    bool oneByte = true;
    for (auto& p : pieces) {
      length += p.length();
      oneByte = oneByte && p.oneByte();
    }
    StringBuilder b(length, oneByte);
    for (auto& p : pieces) p.appendTo(b);
    return std::move(b).build();
  }
}

}  // namespace lucent
