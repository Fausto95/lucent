#include "bigint.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <string>
#include <vector>

#include "jserror.h"
#include "number.h"

namespace lucent {

using Mag = std::vector<uint32_t>;

struct BigInt::Big {
  bool negative;
  Mag magnitude;
};

namespace {

/// V8's limit: beyond it a result throws a RangeError instead of exhausting
/// memory.
constexpr uint64_t kMaxBits = uint64_t{1} << 30;

constexpr uint64_t kLimb = uint64_t{1} << 32;

[[noreturn]] void tooBig() { throwRangeError("Maximum BigInt size exceeded"); }

[[noreturn]] void syntaxError(const std::string& text) {
  throwError(String::fromLatin1("SyntaxError"), String::fromUtf8("Cannot convert " + text + " to a BigInt"));
}

/// A value as a sign and a magnitude, for the paths beyond int64.
struct Parts {
  bool negative = false;
  Mag magnitude;
};

void trim(Mag& m) {
  while (!m.empty() && m.back() == 0) m.pop_back();
}

Mag magnitudeOf(uint64_t u) {
  Mag m;
  if (u) m.push_back(static_cast<uint32_t>(u));
  if (u >> 32) m.push_back(static_cast<uint32_t>(u >> 32));
  return m;
}

uint64_t bitLength(const Mag& m) {
  if (m.empty()) return 0;

  return (m.size() - 1) * 32 + (32 - static_cast<uint64_t>(std::countl_zero(m.back())));
}

int compareMagnitudes(const Mag& a, const Mag& b) {
  if (a.size() != b.size()) return a.size() < b.size() ? -1 : 1;

  for (size_t i = a.size(); i-- > 0;) {
    if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
  }

  return 0;
}

Mag addMagnitudes(const Mag& a, const Mag& b) {
  const Mag& longer = a.size() >= b.size() ? a : b;
  const Mag& shorter = a.size() >= b.size() ? b : a;

  Mag out(longer.size() + 1);
  uint64_t carry = 0;

  for (size_t i = 0; i < longer.size(); i++) {
    uint64_t sum = uint64_t{longer[i]} + (i < shorter.size() ? shorter[i] : 0) + carry;
    out[i] = static_cast<uint32_t>(sum);
    carry = sum >> 32;
  }

  out[longer.size()] = static_cast<uint32_t>(carry);
  trim(out);
  return out;
}

/// a - b, with a >= b.
Mag subtractMagnitudes(const Mag& a, const Mag& b) {
  Mag out(a.size());
  int64_t borrow = 0;

  for (size_t i = 0; i < a.size(); i++) {
    int64_t diff = int64_t{a[i]} - (i < b.size() ? int64_t{b[i]} : 0) - borrow;
    borrow = diff < 0 ? 1 : 0;
    out[i] = static_cast<uint32_t>(diff + (borrow ? static_cast<int64_t>(kLimb) : 0));
  }

  trim(out);
  return out;
}

Mag multiplyMagnitudes(const Mag& a, const Mag& b) {
  if (a.empty() || b.empty()) return {};

  if (bitLength(a) + bitLength(b) > kMaxBits + 1) tooBig();

  Mag out(a.size() + b.size());

  for (size_t i = 0; i < a.size(); i++) {
    uint64_t carry = 0;

    for (size_t j = 0; j < b.size(); j++) {
      uint64_t t = uint64_t{a[i]} * b[j] + out[i + j] + carry;
      out[i + j] = static_cast<uint32_t>(t);
      carry = t >> 32;
    }

    out[i + b.size()] = static_cast<uint32_t>(carry);
  }

  trim(out);
  return out;
}

/// m = m * factor + addend, in place.
void multiplyAdd(Mag& m, uint32_t factor, uint32_t addend) {
  uint64_t carry = addend;

  for (auto& limb : m) {
    uint64_t t = uint64_t{limb} * factor + carry;
    limb = static_cast<uint32_t>(t);
    carry = t >> 32;
  }

  if (carry) m.push_back(static_cast<uint32_t>(carry));
}

/// m /= divisor in place; returns the remainder.
uint32_t divideSmall(Mag& m, uint32_t divisor) {
  uint64_t rest = 0;

  for (size_t i = m.size(); i-- > 0;) {
    uint64_t cur = (rest << 32) | m[i];
    m[i] = static_cast<uint32_t>(cur / divisor);
    rest = cur % divisor;
  }

  trim(m);
  return static_cast<uint32_t>(rest);
}

/// Quotient and remainder of magnitudes (Knuth's algorithm D, as in
/// Hacker's Delight's divmnu).
void divideMagnitudes(const Mag& u, const Mag& v, Mag& quotient, Mag& remainder) {
  if (compareMagnitudes(u, v) < 0) {
    quotient.clear();
    remainder = u;
    return;
  }

  if (v.size() == 1) {
    quotient = u;
    uint32_t r = divideSmall(quotient, v[0]);
    remainder = magnitudeOf(r);
    return;
  }

  const size_t n = v.size();
  const size_t m = u.size();
  const int s = std::countl_zero(v.back());

  // Normalized so that the divisor's top limb has its high bit set.
  Mag vn(n);
  for (size_t i = n - 1; i > 0; i--) vn[i] = s ? (v[i] << s) | (v[i - 1] >> (32 - s)) : v[i];
  vn[0] = v[0] << s;

  Mag un(m + 1);
  un[m] = s ? u[m - 1] >> (32 - s) : 0;
  for (size_t i = m - 1; i > 0; i--) un[i] = s ? (u[i] << s) | (u[i - 1] >> (32 - s)) : u[i];
  un[0] = u[0] << s;

  quotient.assign(m - n + 1, 0);

  for (size_t j = m - n + 1; j-- > 0;) {
    uint64_t numerator = (uint64_t{un[j + n]} << 32) | un[j + n - 1];
    uint64_t qhat = numerator / vn[n - 1];
    uint64_t rhat = numerator % vn[n - 1];

    while (qhat >= kLimb || qhat * vn[n - 2] > ((rhat << 32) | un[j + n - 2])) {
      qhat--;
      rhat += vn[n - 1];
      if (rhat >= kLimb) break;
    }

    // Multiply and subtract.
    int64_t borrow = 0;
    int64_t t = 0;
    for (size_t i = 0; i < n; i++) {
      uint64_t p = qhat * vn[i];
      t = int64_t{un[i + j]} - borrow - static_cast<int64_t>(p & 0xFFFFFFFFu);
      un[i + j] = static_cast<uint32_t>(t);
      borrow = static_cast<int64_t>(p >> 32) - (t >> 32);
    }

    t = int64_t{un[j + n]} - borrow;
    un[j + n] = static_cast<uint32_t>(t);
    quotient[j] = static_cast<uint32_t>(qhat);

    // Subtracted too much: add one divisor back.
    if (t < 0) {
      quotient[j]--;

      uint64_t carry = 0;
      for (size_t i = 0; i < n; i++) {
        uint64_t sum = uint64_t{un[i + j]} + vn[i] + carry;
        un[i + j] = static_cast<uint32_t>(sum);
        carry = sum >> 32;
      }

      un[j + n] = static_cast<uint32_t>(uint64_t{un[j + n]} + carry);
    }
  }

  remainder.assign(n, 0);
  for (size_t i = 0; i < n; i++) remainder[i] = s ? (un[i] >> s) | (un[i + 1] << (32 - s)) : un[i];

  trim(quotient);
  trim(remainder);
}

Mag shiftLeftMagnitude(const Mag& m, uint64_t bits) {
  if (m.empty()) return {};

  if (bitLength(m) + bits > kMaxBits) tooBig();

  size_t limbs = static_cast<size_t>(bits / 32);
  int rest = static_cast<int>(bits % 32);

  Mag out(m.size() + limbs + 1, 0);
  for (size_t i = 0; i < m.size(); i++) {
    out[i + limbs] |= m[i] << rest;
    if (rest) out[i + limbs + 1] |= m[i] >> (32 - rest);
  }

  trim(out);
  return out;
}

Mag shiftRightMagnitude(const Mag& m, uint64_t bits) {
  if (bits >= uint64_t{m.size()} * 32) return {};

  size_t limbs = static_cast<size_t>(bits / 32);
  int rest = static_cast<int>(bits % 32);

  Mag out(m.size() - limbs);
  for (size_t i = 0; i < out.size(); i++) {
    uint32_t low = m[i + limbs] >> rest;
    uint32_t high = rest && i + limbs + 1 < m.size() ? m[i + limbs + 1] << (32 - rest) : 0;
    out[i] = low | high;
  }

  trim(out);
  return out;
}

/// Two's complement in `width` limbs (sign-extended).
Mag twosComplement(const Parts& p, size_t width) {
  Mag out(width, p.negative ? 0xFFFFFFFFu : 0);

  if (!p.negative) {
    std::copy(p.magnitude.begin(), p.magnitude.end(), out.begin());
    return out;
  }

  // -m is ~(m - 1).
  Mag less = subtractMagnitudes(p.magnitude, Mag{1});
  for (size_t i = 0; i < less.size(); i++) out[i] = ~less[i];

  return out;
}

/// The value of `limbs` read as two's complement.
Parts fromTwosComplement(Mag limbs) {
  Parts p;
  p.negative = !limbs.empty() && (limbs.back() & 0x80000000u);

  if (p.negative) {
    for (auto& limb : limbs) limb = ~limb;
    trim(limbs);
    limbs = addMagnitudes(limbs, Mag{1});
  }

  trim(limbs);
  p.magnitude = std::move(limbs);
  return p;
}

/// ToIndex, as BigInt.asIntN and asUintN convert their `bits`.
uint64_t toIndex(double bits) {
  double t = std::isnan(bits) ? 0 : std::trunc(bits);
  if (!(t >= 0 && t <= 9007199254740991.0)) throwRangeError("Invalid value: not (convertible to) a safe integer");

  return static_cast<uint64_t>(t);
}

int digitValue(char16_t c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  return 99;
}

/// radix^k, the largest power below 2^32, and k.
std::pair<uint32_t, int> chunkOf(uint32_t radix) {
  uint64_t power = radix;
  int digits = 1;

  while (power * radix < kLimb) {
    power *= radix;
    digits++;
  }

  return {static_cast<uint32_t>(power), digits};
}

}  // namespace

/// Parts and canonical construction, for the paths beyond int64.
struct BigIntAccess {
  static Parts parts(const BigInt& x) {
    if (x.big_) return {x.big_->negative, x.big_->magnitude};

    bool negative = x.small_ < 0;
    uint64_t u = negative ? static_cast<uint64_t>(-(x.small_ + 1)) + 1 : static_cast<uint64_t>(x.small_);
    return {negative, magnitudeOf(u)};
  }

  static const Mag& magnitude(const BigInt& x) { return x.big_->magnitude; }

  static bool isBig(const BigInt& x) { return x.big_ != nullptr; }

  static int64_t small(const BigInt& x) { return x.small_; }

  static bool negative(const BigInt& x) { return x.big_ ? x.big_->negative : x.small_ < 0; }

  /// The canonical value: inline whenever it fits in int64.
  static BigInt make(bool negative, Mag magnitude) {
    trim(magnitude);

    if (magnitude.size() <= 2) {
      uint64_t u = magnitude.empty() ? 0 : magnitude[0];
      if (magnitude.size() == 2) u |= uint64_t{magnitude[1]} << 32;

      if (!negative && u <= static_cast<uint64_t>(INT64_MAX)) return BigInt::fromInt64(static_cast<int64_t>(u));
      if (negative && u <= uint64_t{1} << 63) return BigInt::fromInt64(u == uint64_t{1} << 63 ? INT64_MIN : -static_cast<int64_t>(u));
    }

    if (bitLength(magnitude) > kMaxBits) tooBig();

    BigInt out;
    out.big_ = std::make_shared<const BigInt::Big>(BigInt::Big{negative, std::move(magnitude)});
    return out;
  }

  static BigInt make(Parts p) { return make(p.negative, std::move(p.magnitude)); }
};

using A = BigIntAccess;

// --- construction ------------------------------------------------------------------

BigInt BigInt::fromUint64Beyond(uint64_t value) { return A::make(false, magnitudeOf(value)); }

BigInt BigInt::fromDouble(double value) {
  if (!std::isfinite(value) || std::trunc(value) != value) {
    throwRangeError(("The number " + numberToString(value).toUtf8() + " cannot be converted to a BigInt because it is not an integer").c_str());
  }

  if (value >= -9223372036854775808.0 && value < 9223372036854775808.0) return fromInt64(static_cast<int64_t>(value));

  // |value| >= 2^63: a 53-bit integer times a power of two.
  int exponent;
  double fraction = std::frexp(std::fabs(value), &exponent);
  auto mantissa = static_cast<uint64_t>(std::ldexp(fraction, 53));

  return A::make(value < 0, shiftLeftMagnitude(magnitudeOf(mantissa), static_cast<uint64_t>(exponent - 53)));
}

BigInt BigInt::fromDigits(std::string_view text, int radix) {
  std::string_view digits = text;
  bool negative = !digits.empty() && digits[0] == '-';
  if (negative) digits.remove_prefix(1);

  if (digits.empty() || radix < 2 || radix > 36) syntaxError(std::string(text));

  // Within 64 bits, no allocation.
  uint64_t value = 0;
  size_t i = 0;

  for (; i < digits.size(); i++) {
    int d = digitValue(static_cast<unsigned char>(digits[i]));
    if (d >= radix) syntaxError(std::string(text));

    uint64_t next;
    if (__builtin_mul_overflow(value, static_cast<uint64_t>(radix), &next) || __builtin_add_overflow(next, static_cast<uint64_t>(d), &next)) break;

    value = next;
  }

  if (i == digits.size()) {
    if (!negative) return fromUint64(value);
    if (value <= uint64_t{1} << 63) return fromInt64(value == uint64_t{1} << 63 ? INT64_MIN : -static_cast<int64_t>(value));

    return A::make(true, magnitudeOf(value));
  }

  Mag m = magnitudeOf(value);
  int perChunk = chunkOf(static_cast<uint32_t>(radix)).second;

  while (i < digits.size()) {
    uint32_t chunk = 0;
    uint32_t factor = 1;

    for (int k = 0; k < perChunk && i < digits.size(); k++, i++) {
      int d = digitValue(static_cast<unsigned char>(digits[i]));
      if (d >= radix) syntaxError(std::string(text));

      chunk = chunk * radix + static_cast<uint32_t>(d);
      factor *= static_cast<uint32_t>(radix);
    }

    multiplyAdd(m, factor, chunk);
  }

  return A::make(negative, std::move(m));
}

namespace {

/// StringToBigInt over any code units.
template <class Unit>
BigInt parseUnits(const Unit* units, size_t length) {
  size_t begin = 0;
  size_t end = length;

  while (begin < end && isJsWhitespace(static_cast<char16_t>(units[begin]))) begin++;
  while (end > begin && isJsWhitespace(static_cast<char16_t>(units[end - 1]))) end--;

  std::string text;
  for (size_t i = 0; i < length; i++) {
    char16_t c = static_cast<char16_t>(units[i]);
    text.push_back(c < 0x80 ? static_cast<char>(c) : '?');
  }

  if (begin == end) return BigInt();

  // Every character left must be ASCII: digits, a sign, a prefix.
  std::string body;
  for (size_t i = begin; i < end; i++) {
    char16_t c = static_cast<char16_t>(units[i]);
    if (c >= 0x80) syntaxError(text);
    body.push_back(static_cast<char>(c));
  }

  int radix = 10;
  std::string_view digits = body;

  if (digits.size() >= 2 && digits[0] == '0') {
    char p = digits[1];
    if (p == 'x' || p == 'X') radix = 16;
    if (p == 'o' || p == 'O') radix = 8;
    if (p == 'b' || p == 'B') radix = 2;
  }

  if (radix != 10) {
    digits.remove_prefix(2);
    if (digits.empty() || digits[0] == '-' || digits[0] == '+') syntaxError(text);

    return BigInt::fromDigits(digits, radix);
  }

  bool negative = false;
  if (digits[0] == '+' || digits[0] == '-') {
    negative = digits[0] == '-';
    digits.remove_prefix(1);
  }

  if (digits.empty() || digits[0] == '-' || digits[0] == '+') syntaxError(text);

  for (char c : digits) {
    if (c < '0' || c > '9') syntaxError(text);
  }

  BigInt value = BigInt::fromDigits(digits, 10);
  return negative ? -value : value;
}

}  // namespace

BigInt BigInt::parse(std::string_view text) { return parseUnits(text.data(), text.size()); }

BigInt BigInt::parse(const String& text) {
  if (text.isOneByte()) {
    std::string_view latin1 = text.latin1();
    return parseUnits(reinterpret_cast<const unsigned char*>(latin1.data()), latin1.size());
  }

  std::u16string_view wide = text.utf16();
  return parseUnits(wide.data(), wide.size());
}

// --- arithmetic ------------------------------------------------------------------

BigInt BigInt::add(const BigInt& a, const BigInt& b, bool subtract) {
  Parts x = A::parts(a);
  Parts y = A::parts(b);
  if (subtract) y.negative = !y.negative && !y.magnitude.empty();

  if (x.negative == y.negative) return A::make(x.negative, addMagnitudes(x.magnitude, y.magnitude));

  int order = compareMagnitudes(x.magnitude, y.magnitude);
  if (order == 0) return BigInt();

  if (order > 0) return A::make(x.negative, subtractMagnitudes(x.magnitude, y.magnitude));

  return A::make(y.negative, subtractMagnitudes(y.magnitude, x.magnitude));
}

BigInt BigInt::multiply(const BigInt& a, const BigInt& b) {
  Parts x = A::parts(a);
  Parts y = A::parts(b);

  return A::make(x.negative != y.negative, multiplyMagnitudes(x.magnitude, y.magnitude));
}

BigInt BigInt::divide(const BigInt& a, const BigInt& b, bool remainder) {
  if (b.isZero()) throwRangeError("Division by zero");

  Parts x = A::parts(a);
  Parts y = A::parts(b);

  Mag q, r;
  divideMagnitudes(x.magnitude, y.magnitude, q, r);

  if (remainder) return A::make(x.negative, std::move(r));

  return A::make(x.negative != y.negative, std::move(q));
}

BigInt BigInt::negateBeyond() const {
  Parts p = A::parts(*this);
  // Read before the move: arguments are evaluated in no set order (GCC goes right to left).
  bool negative = !p.negative && !p.magnitude.empty();

  return A::make(negative, std::move(p.magnitude));
}

BigInt BigInt::pow(const BigInt& base, const BigInt& exponent) {
  if (exponent.sign() < 0) throwRangeError("Exponent must be non-negative");

  if (exponent.isZero()) return fromInt64(1);

  if (base.isZero() || base == fromInt64(1)) return base;

  if (base == fromInt64(-1)) return (exponent & fromInt64(1)).isZero() ? fromInt64(1) : base;

  // Any larger base doubles in size at least every step.
  if (A::isBig(exponent) || A::small(exponent) > static_cast<int64_t>(kMaxBits)) tooBig();

  auto e = static_cast<uint64_t>(A::small(exponent));

  // Within 64 bits, no allocation.
  if (!A::isBig(base)) {
    int64_t result = 1;
    int64_t square = A::small(base);
    uint64_t left = e;
    bool fits = true;

    while (left) {
      if ((left & 1) && __builtin_mul_overflow(result, square, &result)) {
        fits = false;
        break;
      }

      left >>= 1;
      if (left && __builtin_mul_overflow(square, square, &square)) {
        fits = false;
        break;
      }
    }

    if (fits) return fromInt64(result);
  }

  Parts p = A::parts(base);
  if ((bitLength(p.magnitude) - 1) * e > kMaxBits) tooBig();

  Mag result{1};
  Mag square = p.magnitude;

  for (uint64_t left = e; left; left >>= 1) {
    if (left & 1) result = multiplyMagnitudes(result, square);
    if (left > 1) square = multiplyMagnitudes(square, square);
  }

  return A::make(p.negative && (e & 1), std::move(result));
}

// --- bits ---------------------------------------------------------------------------

BigInt BigInt::bitwise(const BigInt& a, const BigInt& b, char op) {
  Parts x = A::parts(a);
  Parts y = A::parts(b);
  size_t width = std::max(x.magnitude.size(), y.magnitude.size()) + 1;

  Mag l = twosComplement(x, width);
  Mag r = twosComplement(y, width);

  for (size_t i = 0; i < width; i++) {
    if (op == '&') l[i] &= r[i];
    if (op == '|') l[i] |= r[i];
    if (op == '^') l[i] ^= r[i];
  }

  return A::make(fromTwosComplement(std::move(l)));
}

BigInt BigInt::shift(const BigInt& a, const BigInt& count, bool left) {
  // A count beyond int64 moves every bit out, or far past the limit.
  if (A::isBig(count)) {
    bool growing = left != A::negative(count);
    if (!growing) return a.sign() < 0 ? fromInt64(-1) : BigInt();
    if (a.isZero()) return a;
    tooBig();
  }

  int64_t n = A::small(count);
  if (!left) n = n == INT64_MIN ? INT64_MAX : -n;

  // From here, n > 0 shifts left and n < 0 right.
  if (n >= 0) {
    if (a.isZero()) return a;

    if (!A::isBig(a) && n < 63) {
      int64_t r;
      if (!__builtin_mul_overflow(A::small(a), int64_t{1} << n, &r)) return fromInt64(r);
    }

    Parts p = A::parts(a);
    return A::make(p.negative, shiftLeftMagnitude(p.magnitude, static_cast<uint64_t>(n)));
  }

  uint64_t bits = n == INT64_MIN ? uint64_t{1} << 63 : static_cast<uint64_t>(-n);

  if (!A::isBig(a)) {
    int64_t v = A::small(a);
    if (bits >= 63) return fromInt64(v < 0 ? -1 : 0);

    return fromInt64(v >> bits);
  }

  Parts p = A::parts(a);
  if (!p.negative) return A::make(false, shiftRightMagnitude(p.magnitude, bits));

  // Toward negative infinity: -(((|a| - 1) >> bits) + 1).
  Mag shifted = shiftRightMagnitude(subtractMagnitudes(p.magnitude, Mag{1}), bits);
  return A::make(true, addMagnitudes(shifted, Mag{1}));
}

BigInt BigInt::unsignedShiftRight(const BigInt&, const BigInt&) {
  throwTypeError("BigInts have no unsigned right shift, use >> instead");
}

BigInt BigInt::asUintN(double bitsValue, const BigInt& value) {
  uint64_t bits = toIndex(bitsValue);
  if (bits == 0) return BigInt();

  Parts p = A::parts(value);
  if (!p.negative && bitLength(p.magnitude) <= bits) return value;

  // A negative value becomes 2^bits minus its magnitude: that many bits.
  if (bits > kMaxBits) tooBig();

  size_t width = static_cast<size_t>((bits + 31) / 32);
  Mag limbs = twosComplement(p, std::max(width, p.magnitude.size() + 1));
  limbs.resize(width);

  if (bits % 32) limbs.back() &= (uint32_t{1} << (bits % 32)) - 1;

  return A::make(false, std::move(limbs));
}

BigInt BigInt::asIntN(double bitsValue, const BigInt& value) {
  uint64_t bits = toIndex(bitsValue);
  if (bits == 0) return BigInt();

  Parts p = A::parts(value);

  // Already within [-2^(bits-1), 2^(bits-1)).
  if (bitLength(p.magnitude) + 1 < bits) return value;

  size_t width = static_cast<size_t>((bits + 31) / 32);
  Mag limbs = twosComplement(p, std::max(width, p.magnitude.size() + 1));
  limbs.resize(width);

  // Sign-extend from bit `bits - 1` across the top limb.
  unsigned top = static_cast<unsigned>((bits - 1) % 32);
  uint32_t& last = limbs.back();
  bool negative = (last >> top) & 1;

  if (top < 31) {
    uint32_t above = ~((uint32_t{1} << (top + 1)) - 1);
    last = negative ? (last | above) : (last & ~above);
  }

  return A::make(fromTwosComplement(std::move(limbs)));
}

// --- comparisons ------------------------------------------------------------------

int BigInt::sign() const noexcept {
  if (big_) return big_->negative ? -1 : 1;

  return small_ < 0 ? -1 : (small_ > 0 ? 1 : 0);
}

bool BigInt::equalBeyond(const BigInt& a, const BigInt& b) noexcept {
  if (!a.big_ || !b.big_) return false;

  return a.big_->negative == b.big_->negative && a.big_->magnitude == b.big_->magnitude;
}

std::strong_ordering BigInt::compareBeyond(const BigInt& a, const BigInt& b) noexcept {
  // Canonical: a value beyond int64 is beyond every inline one.
  if (!b.big_) return a.big_->negative ? std::strong_ordering::less : std::strong_ordering::greater;
  if (!a.big_) return b.big_->negative ? std::strong_ordering::greater : std::strong_ordering::less;

  if (a.big_->negative != b.big_->negative) return a.big_->negative ? std::strong_ordering::less : std::strong_ordering::greater;

  int order = compareMagnitudes(a.big_->magnitude, b.big_->magnitude);
  if (a.big_->negative) order = -order;

  return order < 0 ? std::strong_ordering::less : order > 0 ? std::strong_ordering::greater : std::strong_ordering::equal;
}

std::partial_ordering compare(const BigInt& a, double b) noexcept {
  if (std::isnan(b)) return std::partial_ordering::unordered;
  if (std::isinf(b)) return b > 0 ? std::partial_ordering::less : std::partial_ordering::greater;

  constexpr double kTwo63 = 9223372036854775808.0;
  double floor = std::floor(b);
  bool integral = floor == b;

  if (!A::isBig(a)) {
    if (b >= kTwo63) return std::partial_ordering::less;
    if (b < -kTwo63) return std::partial_ordering::greater;

    // An integer below b's fraction is below b; at or above its ceiling, above.
    auto f = static_cast<int64_t>(floor);
    int64_t v = A::small(a);

    if (integral) return v <=> f;
    return v <= f ? std::partial_ordering::less : std::partial_ordering::greater;
  }

  // Beyond int64 and |b| finite: exact, through b's integer part (a double
  // this large is an integer already).
  BigInt f = BigInt::fromDouble(floor);
  auto order = a <=> f;

  if (integral || order != 0) return order;
  return std::partial_ordering::less;
}

// --- conversions ----------------------------------------------------------------------

String BigInt::toString() const { return toString(10); }

String BigInt::toString(double radixValue) const {
  double r = std::isnan(radixValue) ? 0 : std::trunc(radixValue);
  if (!(r >= 2 && r <= 36)) throwRangeError("toString() radix argument must be between 2 and 36");

  auto radix = static_cast<uint32_t>(r);
  static constexpr char kDigits[] = "0123456789abcdefghijklmnopqrstuvwxyz";

  std::string out;

  if (!big_) {
    uint64_t u = small_ < 0 ? static_cast<uint64_t>(-(small_ + 1)) + 1 : static_cast<uint64_t>(small_);

    do {
      out.push_back(kDigits[u % radix]);
      u /= radix;
    } while (u);

    if (small_ < 0) out.push_back('-');

    std::reverse(out.begin(), out.end());
    return String::fromLatin1(out);
  }

  Mag m = big_->magnitude;
  auto [power, perChunk] = chunkOf(radix);

  // Least significant chunk first, each padded to its full width but the
  // last.
  while (!m.empty()) {
    uint32_t chunk = divideSmall(m, power);

    for (int k = 0; k < perChunk && (chunk || !m.empty()); k++) {
      out.push_back(kDigits[chunk % radix]);
      chunk /= radix;
    }
  }

  if (big_->negative) out.push_back('-');

  std::reverse(out.begin(), out.end());
  return String::fromLatin1(out);
}

double BigInt::toDouble() const noexcept {
  if (!big_) return static_cast<double>(small_);

  const Mag& m = big_->magnitude;
  uint64_t length = bitLength(m);
  double sign = big_->negative ? -1.0 : 1.0;

  if (length > 1024) return sign * std::numeric_limits<double>::infinity();

  // The top 64 bits, and whether any below them is set.
  uint64_t below = length - 64;
  Mag top = shiftRightMagnitude(m, below);
  uint64_t high = top[0] | (top.size() > 1 ? uint64_t{top[1]} << 32 : 0);

  bool sticky = false;
  for (uint64_t i = 0; i < below / 32 && !sticky; i++) sticky = m[i] != 0;
  if (!sticky && below % 32) sticky = (m[below / 32] & ((uint32_t{1} << (below % 32)) - 1)) != 0;

  // To 53 bits, the nearest, ties to even.
  uint64_t mantissa = high >> 11;
  uint64_t rest = high & 0x7FF;

  if (rest > 0x400 || (rest == 0x400 && (sticky || (mantissa & 1)))) mantissa++;

  return sign * std::ldexp(static_cast<double>(mantissa), static_cast<int>(length - 53));
}

void BigInt::throwOutOfRange(bool isSigned) const {
  throwRangeError((toString().toUtf8() + (isSigned ? " is out of range for a 64-bit signed integer" : " is out of range for a 64-bit unsigned integer")).c_str());
}

uint64_t BigInt::toUint64Beyond() const {
  if (auto u = tryUint64()) return *u;

  throwOutOfRange(false);
}

std::optional<uint64_t> BigInt::tryUint64() const noexcept {
  if (!big_) {
    if (small_ < 0) return std::nullopt;
    return static_cast<uint64_t>(small_);
  }

  if (big_->negative || big_->magnitude.size() > 2) return std::nullopt;

  return uint64_t{big_->magnitude[0]} | uint64_t{big_->magnitude[1]} << 32;
}

uint64_t BigInt::wrapBeyond() const noexcept {
  const Mag& m = big_->magnitude;
  uint64_t low = uint64_t{m[0]} | (m.size() > 1 ? uint64_t{m[1]} << 32 : 0);

  return big_->negative ? ~low + 1 : low;
}

size_t BigInt::hash() const noexcept {
  if (!big_) return std::hash<int64_t>()(small_);

  uint64_t h = big_->negative ? 0xcbf29ce484222325ull : 0x84222325cbf29ce4ull;
  for (uint32_t limb : big_->magnitude) h = (h ^ limb) * 0x100000001b3ull;

  return static_cast<size_t>(h);
}

String toJsString(const BigInt& value) { return value.toString(); }

namespace detail {

void throwOutOfNativeRange(const BigInt& value, const char* what, bool isSigned, size_t bits) {
  std::string message = std::string(what) + ": " + value.toString().toUtf8() + " is out of range for a " +
                        std::to_string(bits) + "-bit " + (isSigned ? "signed" : "unsigned") + " integer";
  throwRangeError(message.c_str());
}

}  // namespace detail

}  // namespace lucent
