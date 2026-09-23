#include "number.h"

#include <algorithm>
#include <cstdio>
#include <vector>
#include <cstdlib>
#include <cstring>
#include <random>
#include <string>

namespace lucent {

namespace {

// Decimal digits and exponent of a finite, positive double: v = 0.d1d2...dk * 10^n.
struct Decimal {
  std::string digits;
  int n = 0;
};

// Parses the output of printf("%.*e"), tolerating any locale decimal mark.
Decimal parseScientific(const char* buf) {
  Decimal d;
  const char* p = buf;
  while (*p && *p != 'e' && *p != 'E') {
    if (*p >= '0' && *p <= '9') d.digits.push_back(*p);
    p++;
  }
  int exp = (*p) ? std::atoi(p + 1) : 0;
  while (d.digits.size() > 1 && d.digits.back() == '0') d.digits.pop_back();
  d.n = exp + 1;
  return d;
}

/// `a` (positive, finite) rounded to `significant` digits, with exact ties
/// rounded up, as Number.prototype.toPrecision/toExponential specify. printf
/// with 800 digits prints the exact binary value (at most 767 significant
/// digits), so the rounding decision sees every digit.
Decimal roundHalfUp(double a, int significant) {
  static thread_local char buf[1024];
  std::snprintf(buf, sizeof buf, "%.800e", a);
  Decimal exact = parseScientific(buf);
  Decimal d{exact.digits, exact.n};
  d.digits.resize(std::max<size_t>(d.digits.size(), static_cast<size_t>(significant) + 1), '0');
  bool up = d.digits[static_cast<size_t>(significant)] >= '5';
  d.digits.resize(static_cast<size_t>(significant));
  if (up) {
    int i = significant - 1;
    while (i >= 0 && d.digits[static_cast<size_t>(i)] == '9') d.digits[static_cast<size_t>(i--)] = '0';
    if (i >= 0) {
      d.digits[static_cast<size_t>(i)]++;
    } else {
      d.digits.insert(d.digits.begin(), '1');
      d.digits.pop_back();
      d.n++;
    }
  }
  return d;
}

Decimal withPrecision(double v, int precision) {
  char buf[64];
  std::snprintf(buf, sizeof buf, "%.*e", precision - 1, v);
  return parseScientific(buf);
}

bool roundTrips(double v, int precision) {
  char buf[64];
  std::snprintf(buf, sizeof buf, "%.*e", precision - 1, v);
  // strtod needs '.', which is what the C locale prints.
  for (char* c = buf; *c; c++) {
    if (*c == ',') *c = '.';
  }
  return std::strtod(buf, nullptr) == v;
}

// Shortest digit string that round-trips (ECMA-262 Number::toString step 5).
Decimal shortest(double v) {
  int lo = 1, hi = 17;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (roundTrips(v, mid)) hi = mid;
    else lo = mid + 1;
  }
  return withPrecision(v, lo);
}

std::string formatDecimal(const Decimal& d) {
  const std::string& s = d.digits;
  int k = static_cast<int>(s.size());
  int n = d.n;
  std::string out;
  if (k <= n && n <= 21) {
    out = s;
    out.append(static_cast<size_t>(n - k), '0');
  } else if (0 < n && n <= 21) {
    out = s.substr(0, static_cast<size_t>(n)) + "." + s.substr(static_cast<size_t>(n));
  } else if (-6 < n && n <= 0) {
    out = "0.";
    out.append(static_cast<size_t>(-n), '0');
    out += s;
  } else {
    int e = n - 1;
    out = s.substr(0, 1);
    if (k > 1) out += "." + s.substr(1);
    out += e >= 0 ? "e+" : "e-";
    out += std::to_string(e >= 0 ? e : -e);
  }
  return out;
}

bool isDigitIn(char16_t c, int radix, int& value) {
  int v;
  if (c >= '0' && c <= '9') v = c - '0';
  else if (c >= 'a' && c <= 'z') v = c - 'a' + 10;
  else if (c >= 'A' && c <= 'Z') v = c - 'A' + 10;
  else return false;
  if (v >= radix) return false;
  value = v;
  return true;
}

// Exact decimal expansion of |v| with `fraction` digits after the point,
// rounded half away from zero on the exact binary value (Number::toFixed).
std::string fixedDigits(double v, int fraction) {
  // printf prints the exact binary value when given enough precision; 1100
  // digits covers every double's fractional expansion.
  static thread_local std::vector<char> buf(1600);
  int len = std::snprintf(buf.data(), buf.size(), "%.1100f", std::fabs(v));
  std::string s(buf.data(), static_cast<size_t>(len));
  for (auto& c : s) {
    if (c == ',') c = '.';
  }
  size_t dot = s.find('.');
  std::string intPart = s.substr(0, dot);
  std::string frac = s.substr(dot + 1);
  std::string kept = intPart + frac.substr(0, static_cast<size_t>(fraction));
  bool roundUp = frac.size() > static_cast<size_t>(fraction) && frac[static_cast<size_t>(fraction)] >= '5';
  if (roundUp) {
    int i = static_cast<int>(kept.size()) - 1;
    while (i >= 0) {
      if (kept[static_cast<size_t>(i)] == '9') {
        kept[static_cast<size_t>(i)] = '0';
        i--;
      } else {
        kept[static_cast<size_t>(i)]++;
        break;
      }
    }
    if (i < 0) kept.insert(kept.begin(), '1');
  }
  size_t intLen = kept.size() - static_cast<size_t>(fraction);
  std::string out = kept.substr(0, intLen);
  if (out.empty()) out = "0";
  if (fraction > 0) out += "." + kept.substr(intLen);
  return out;
}

}  // namespace

String numberToString(double v) {
  if (std::isnan(v)) return String::fromLatin1("NaN");
  if (v == 0) return String::fromLatin1("0");
  if (std::isinf(v)) return String::fromLatin1(v > 0 ? "Infinity" : "-Infinity");
  if (std::fabs(v) < 9007199254740992.0 && std::trunc(v) == v) {
    return String::fromLatin1(std::to_string(static_cast<int64_t>(v)));
  }
  std::string out = v < 0 ? "-" : "";
  out += formatDecimal(shortest(std::fabs(v)));
  return String::fromLatin1(out);
}

String numberToString(double v, double radixValue) {
  double r = std::trunc(radixValue);
  if (std::isnan(radixValue)) r = 10;
  if (r < 2 || r > 36) throwRangeError("toString() radix must be between 2 and 36");
  int radix = static_cast<int>(r);
  if (radix == 10 || std::isnan(v) || std::isinf(v) || v == 0) return numberToString(v);
  static const char* chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  bool negative = v < 0;
  double value = std::fabs(v);
  double integer = std::floor(value);
  double fraction = value - integer;
  // Fractional digits: emit while they still distinguish the value, the way
  // V8's DoubleToRadixCString does.
  double delta = 0.5 * (std::nextafter(value, kInfinity) - value);
  delta = std::max(std::nextafter(0.0, 1.0), delta);
  std::string fracDigits;
  if (fraction >= delta) {
    do {
      fraction *= radix;
      delta *= radix;
      int digit = static_cast<int>(fraction);
      fracDigits.push_back(chars[digit]);
      fraction -= digit;
      if (fraction > 0.5 || (fraction == 0.5 && (digit & 1))) {
        if (fraction + delta > 1) {
          // Round up and propagate.
          for (;;) {
            if (fracDigits.empty()) {
              integer += 1;
              break;
            }
            char& last = fracDigits.back();
            int d = static_cast<int>(std::strchr(chars, last) - chars) + 1;
            if (d < radix) {
              last = chars[d];
              break;
            }
            fracDigits.pop_back();
          }
          break;
        }
      }
    } while (fraction >= delta);
  }
  std::string intDigits;
  if (integer == 0) {
    intDigits = "0";
  } else {
    while (integer >= 1) {
      double q = std::floor(integer / radix);
      int digit = static_cast<int>(integer - q * radix);
      intDigits.push_back(chars[digit]);
      integer = q;
    }
    std::reverse(intDigits.begin(), intDigits.end());
  }
  std::string out = negative ? "-" : "";
  out += intDigits;
  if (!fracDigits.empty()) out += "." + fracDigits;
  return String::fromLatin1(out);
}

String numberToFixed(double v, double digitsValue) {
  double f = std::isnan(digitsValue) ? 0 : std::trunc(digitsValue);
  if (f < 0 || f > 100) throwRangeError("toFixed() digits argument must be between 0 and 100");
  if (std::isnan(v)) return String::fromLatin1("NaN");
  if (std::fabs(v) >= 1e21 || std::isinf(v)) return numberToString(v);
  std::string digits = fixedDigits(v, static_cast<int>(f));
  bool allZero = digits.find_first_not_of("0.") == std::string::npos;
  std::string out = (v < 0 && !allZero) ? "-" : "";
  return String::fromLatin1(out + digits);
}

String numberToExponential(double v, double digitsValue) {
  if (std::isnan(v)) return String::fromLatin1("NaN");
  if (std::isinf(v)) return numberToString(v);
  double f = std::isnan(digitsValue) ? 0 : std::trunc(digitsValue);
  if (f < 0 || f > 100) throwRangeError("toExponential() argument must be between 0 and 100");
  std::string out = v < 0 ? "-" : "";
  double a = std::fabs(v);
  Decimal d;
  if (a == 0) {
    d.digits = std::string(static_cast<size_t>(f) + 1, '0');
    d.n = 1;
  } else {
    d = roundHalfUp(a, static_cast<int>(f) + 1);
  }
  out += d.digits.substr(0, 1);
  if (f > 0) out += "." + d.digits.substr(1);
  int e = a == 0 ? 0 : d.n - 1;
  out += e >= 0 ? "e+" : "e-";
  out += std::to_string(e >= 0 ? e : -e);
  return String::fromLatin1(out);
}

String numberToExponential(double v) {
  if (std::isnan(v)) return String::fromLatin1("NaN");
  if (std::isinf(v)) return numberToString(v);
  std::string out = v < 0 ? "-" : "";
  double a = std::fabs(v);
  Decimal d = a == 0 ? Decimal{"0", 1} : shortest(a);
  out += d.digits.substr(0, 1);
  if (d.digits.size() > 1) out += "." + d.digits.substr(1);
  int e = a == 0 ? 0 : d.n - 1;
  out += e >= 0 ? "e+" : "e-";
  out += std::to_string(e >= 0 ? e : -e);
  return String::fromLatin1(out);
}

String numberToPrecision(double v, double precisionValue) {
  if (std::isnan(v)) return String::fromLatin1("NaN");
  if (std::isinf(v)) return numberToString(v);
  double pv = std::isnan(precisionValue) ? 0 : std::trunc(precisionValue);
  if (pv < 1 || pv > 100) throwRangeError("toPrecision() argument must be between 1 and 100");
  int p = static_cast<int>(pv);
  std::string out = v < 0 ? "-" : "";
  double a = std::fabs(v);
  Decimal d;
  int e;
  if (a == 0) {
    d.digits = std::string(static_cast<size_t>(p), '0');
    e = 0;
  } else {
    d = roundHalfUp(a, p);
    e = d.n - 1;
  }
  if (e < -6 || e >= p) {
    out += d.digits.substr(0, 1);
    if (p > 1) out += "." + d.digits.substr(1);
    out += e >= 0 ? "e+" : "e-";
    out += std::to_string(e >= 0 ? e : -e);
  } else if (e == p - 1) {
    out += d.digits;
  } else if (e >= 0) {
    out += d.digits.substr(0, static_cast<size_t>(e) + 1) + "." + d.digits.substr(static_cast<size_t>(e) + 1);
  } else {
    out += "0.";
    out.append(static_cast<size_t>(-(e + 1)), '0');
    out += d.digits;
  }
  return String::fromLatin1(out);
}

double stringToNumber(const String& input) {
  String s = input.trim();
  size_t n = s.length();
  if (n == 0) return 0;
  std::string a;
  a.reserve(n);
  for (size_t i = 0; i < n; i++) {
    char16_t c = s.unit(i);
    if (c >= 0x80) return kNaN;
    a.push_back(static_cast<char>(c));
  }
  if (a == "Infinity" || a == "+Infinity") return kInfinity;
  if (a == "-Infinity") return -kInfinity;
  if (n > 2 && a[0] == '0' && (a[1] == 'x' || a[1] == 'X' || a[1] == 'o' || a[1] == 'O' || a[1] == 'b' || a[1] == 'B')) {
    int radix = (a[1] == 'x' || a[1] == 'X') ? 16 : (a[1] == 'o' || a[1] == 'O') ? 8 : 2;
    double r = 0;
    for (size_t i = 2; i < n; i++) {
      int d;
      if (!isDigitIn(static_cast<char16_t>(a[i]), radix, d)) return kNaN;
      r = r * radix + d;
    }
    return r;
  }
  // StrDecimalLiteral: [+-] (digits [. digits] | . digits) [(e|E) [+-] digits]
  size_t i = 0;
  if (a[i] == '+' || a[i] == '-') i++;
  size_t intDigits = 0, fracDigits = 0;
  while (i < n && a[i] >= '0' && a[i] <= '9') {
    i++;
    intDigits++;
  }
  if (i < n && a[i] == '.') {
    i++;
    while (i < n && a[i] >= '0' && a[i] <= '9') {
      i++;
      fracDigits++;
    }
  }
  if (intDigits + fracDigits == 0) return kNaN;
  if (i < n && (a[i] == 'e' || a[i] == 'E')) {
    i++;
    if (i < n && (a[i] == '+' || a[i] == '-')) i++;
    size_t expDigits = 0;
    while (i < n && a[i] >= '0' && a[i] <= '9') {
      i++;
      expDigits++;
    }
    if (expDigits == 0) return kNaN;
  }
  if (i != n) return kNaN;
  return std::strtod(a.c_str(), nullptr);
}

double parseFloat(const String& input) {
  String s = input.trimStart();
  size_t n = s.length();
  std::string a;
  for (size_t i = 0; i < n && s.unit(i) < 0x80; i++) a.push_back(static_cast<char>(s.unit(i)));
  size_t i = 0;
  bool negative = false;
  if (i < a.size() && (a[i] == '+' || a[i] == '-')) {
    negative = a[i] == '-';
    i++;
  }
  if (a.compare(i, 8, "Infinity") == 0) return negative ? -kInfinity : kInfinity;
  size_t start = 0, digits = 0;
  while (i < a.size() && a[i] >= '0' && a[i] <= '9') {
    i++;
    digits++;
  }
  if (i < a.size() && a[i] == '.') {
    i++;
    while (i < a.size() && a[i] >= '0' && a[i] <= '9') {
      i++;
      digits++;
    }
  }
  if (digits == 0) return kNaN;
  size_t end = i;
  if (i < a.size() && (a[i] == 'e' || a[i] == 'E')) {
    size_t j = i + 1;
    if (j < a.size() && (a[j] == '+' || a[j] == '-')) j++;
    size_t e = 0;
    while (j < a.size() && a[j] >= '0' && a[j] <= '9') {
      j++;
      e++;
    }
    if (e > 0) end = j;
  }
  return std::strtod(a.substr(start, end).c_str(), nullptr);
}

double parseInt(const String& s) { return parseInt(s, 0); }

double parseInt(const String& input, double radixValue) {
  String s = input.trimStart();
  size_t n = s.length(), i = 0;
  bool negative = false;
  if (i < n && (s.unit(i) == '+' || s.unit(i) == '-')) {
    negative = s.unit(i) == '-';
    i++;
  }
  int radix = std::isnan(radixValue) ? 0 : static_cast<int>(toInt32(radixValue));
  bool stripPrefix = true;
  if (radix != 0) {
    if (radix < 2 || radix > 36) return kNaN;
    if (radix != 16) stripPrefix = false;
  } else {
    radix = 10;
  }
  if (stripPrefix && i + 1 < n && s.unit(i) == '0' && (s.unit(i + 1) == 'x' || s.unit(i + 1) == 'X')) {
    i += 2;
    radix = 16;
  }
  double r = 0;
  size_t start = i;
  std::string decimal;
  while (i < n) {
    int d;
    if (!isDigitIn(s.unit(i), radix, d)) break;
    if (radix == 10) decimal.push_back(static_cast<char>(s.unit(i)));
    r = r * radix + d;
    i++;
  }
  if (i == start) return kNaN;
  // Base 10 goes through strtod so large values round like JavaScript engines.
  if (radix == 10) r = std::strtod(decimal.c_str(), nullptr);
  return negative ? -r : r;
}

double jsPow(double a, double b) {
  if (std::isnan(b)) return kNaN;
  if (b == 0) return 1;
  if ((a == 1 || a == -1) && std::isinf(b)) return kNaN;
  return std::pow(a, b);
}

namespace math {

double round(double v) {
  if (!std::isfinite(v) || v == 0) return v;
  if (v > 0 && v < 0.5) return 0.0;
  if (v < 0 && v >= -0.5) return -0.0;
  double f = std::floor(v);
  return (v - f >= 0.5) ? f + 1 : f;
}

double cbrt(double x) {
  // Port of fdlibm s_cbrt.c (as used by V8).
  static const uint32_t B1 = 715094163, B2 = 696219795;
  static const double P0 = 1.87595182427177009643, P1 = -1.88497979543377169875, P2 = 1.621429720105354466140,
                      P3 = -0.758397934778766047437, P4 = 0.145996192886612446982;
  uint64_t bits;
  std::memcpy(&bits, &x, sizeof bits);
  uint32_t hx = static_cast<uint32_t>(bits >> 32) & 0x7fffffff;
  uint32_t sign = static_cast<uint32_t>(bits >> 32) & 0x80000000;
  if (hx >= 0x7ff00000) return x + x;
  double t;
  if (hx < 0x00100000) {
    if ((hx | static_cast<uint32_t>(bits)) == 0) return x;
    t = 18014398509481984.0;  // 2^54
    t *= x;
    uint64_t tb;
    std::memcpy(&tb, &t, sizeof tb);
    uint32_t high = static_cast<uint32_t>(tb >> 32) & 0x7fffffff;
    tb = static_cast<uint64_t>(sign | (high / 3 + B2)) << 32;
    std::memcpy(&t, &tb, sizeof t);
  } else {
    uint64_t tb = static_cast<uint64_t>(sign | (hx / 3 + B1)) << 32;
    std::memcpy(&t, &tb, sizeof t);
  }
  double r = (t * t) * (t / x);
  t = t * ((P0 + r * (P1 + r * P2)) + ((r * r) * r) * (P3 + r * P4));
  uint64_t tb;
  std::memcpy(&tb, &t, sizeof tb);
  tb = (tb + 0x80000000ULL) & 0xffffffffc0000000ULL;
  std::memcpy(&t, &tb, sizeof t);
  double s = t * t;
  r = x / s;
  double w = t + t;
  r = (r - t) / (w + r);
  t = t + t * r;
  return t;
}

double hypot(double a, double b) {
  if (std::isinf(a) || std::isinf(b)) return kInfinity;
  return std::hypot(a, b);
}

double hypot(double a, double b, double c) {
  if (std::isinf(a) || std::isinf(b) || std::isinf(c)) return kInfinity;
  return std::sqrt(a * a + b * b + c * c);
}

double random() {
  static thread_local std::mt19937_64 engine{std::random_device{}()};
  return static_cast<double>(engine() >> 11) * (1.0 / 9007199254740992.0);
}

double min() { return kInfinity; }
double max() { return -kInfinity; }
double min(double a) { return a; }
double max(double a) { return a; }
double min(double a, double b) {
  if (std::isnan(a) || std::isnan(b)) return kNaN;
  if (a == 0 && b == 0) return std::signbit(a) ? a : b;
  return a < b ? a : b;
}
double max(double a, double b) {
  if (std::isnan(a) || std::isnan(b)) return kNaN;
  if (a == 0 && b == 0) return std::signbit(a) ? b : a;
  return a > b ? a : b;
}

}  // namespace math

}  // namespace lucent
