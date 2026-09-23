// Lucent runtime — ECMAScript number semantics.
#pragma once

#include <cmath>
#include <cstdint>
#include <limits>

#include "jsstring.h"

namespace lucent {

inline constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();
inline constexpr double kInfinity = std::numeric_limits<double>::infinity();

/// ECMAScript ToInt32.
inline int32_t toInt32(double v) {
  if (v >= -2147483648.0 && v <= 2147483647.0) return static_cast<int32_t>(v);  // fast path, truncates
  if (v >= 0 && v < 4294967296.0) return static_cast<int32_t>(static_cast<uint32_t>(v));  // results of >>> 0
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

}  // namespace lucent
