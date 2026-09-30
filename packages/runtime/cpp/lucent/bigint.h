// Lucent runtime — BigInt.
//
// `bigint` with JavaScript's semantics at any precision: an immutable value,
// cheap to copy. A value that fits in 64 bits (every native ID and count,
// Long.MAX_VALUE, NSNotFound) is held inline and never allocates; a larger
// one lives in shared, immutable 32-bit limbs, so copying it is a
// reference-count increment. The form is canonical (a value that fits in
// int64 is always inline), so equality and hashing are cheap and exact.
//
// Every operation is JavaScript's: division truncates toward zero and the
// remainder takes the dividend's sign; bitwise operators and shifts act on
// an infinitely wide two's complement; `>>>` throws a TypeError; division
// by zero, a negative exponent, and a result beyond 2^30 bits (V8's limit)
// throw a RangeError. Conversions to native 64-bit integers are exact
// (RangeError when out of range) or wrapping (BigInt.asIntN(64) and
// asUintN(64)).
#pragma once

#include <compare>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <string_view>
#include <type_traits>

#include "core.h"
#include "jsstring.h"

namespace lucent {

class BigInt {
 public:
  /// 0n.
  constexpr BigInt() noexcept = default;

  /// Any C++ integer, exactly: what a native 64-bit value becomes.
  template <std::integral I>
    requires(!std::same_as<I, bool>)
  explicit BigInt(I value) {
    if constexpr (std::is_signed_v<I>) {
      small_ = static_cast<int64_t>(value);
    } else {
      *this = fromUint64(static_cast<uint64_t>(value));
    }
  }

  static BigInt fromInt64(int64_t value) noexcept {
    BigInt b;
    b.small_ = value;
    return b;
  }

  static BigInt fromUint64(uint64_t value) {
    if (value <= static_cast<uint64_t>(INT64_MAX)) return fromInt64(static_cast<int64_t>(value));

    return fromUint64Beyond(value);
  }

  /// `BigInt(number)`: RangeError unless `value` is an integer.
  static BigInt fromDouble(double value);

  /// `BigInt(string)`: whitespace around a decimal integer with an optional
  /// sign, or a 0x/0o/0b literal without one; empty is 0n. Anything else
  /// throws a SyntaxError.
  static BigInt parse(const String& text);
  static BigInt parse(std::string_view text);

  /// Digits in `radix` (2 to 36) after an optional "-", as
  /// BigInt.prototype.toString writes them. SyntaxError otherwise.
  static BigInt fromDigits(std::string_view digits, int radix);

  // --- JavaScript operators ------------------------------------------------------

  friend BigInt operator+(const BigInt& a, const BigInt& b) {
    int64_t r;
    if (!a.big_ && !b.big_ && !__builtin_add_overflow(a.small_, b.small_, &r)) return fromInt64(r);

    return add(a, b, false);
  }

  friend BigInt operator-(const BigInt& a, const BigInt& b) {
    int64_t r;
    if (!a.big_ && !b.big_ && !__builtin_sub_overflow(a.small_, b.small_, &r)) return fromInt64(r);

    return add(a, b, true);
  }

  friend BigInt operator*(const BigInt& a, const BigInt& b) {
    int64_t r;
    if (!a.big_ && !b.big_ && !__builtin_mul_overflow(a.small_, b.small_, &r)) return fromInt64(r);

    return multiply(a, b);
  }

  /// Truncates toward zero. RangeError when `b` is 0n.
  friend BigInt operator/(const BigInt& a, const BigInt& b) {
    if (!a.big_ && !b.big_ && b.small_ != 0 && !(a.small_ == INT64_MIN && b.small_ == -1)) return fromInt64(a.small_ / b.small_);

    return divide(a, b, false);
  }

  /// Takes the dividend's sign. RangeError when `b` is 0n.
  friend BigInt operator%(const BigInt& a, const BigInt& b) {
    if (!a.big_ && !b.big_ && b.small_ != 0) return fromInt64(b.small_ == -1 ? 0 : a.small_ % b.small_);

    return divide(a, b, true);
  }

  /// `base ** exponent`. RangeError for a negative exponent.
  static BigInt pow(const BigInt& base, const BigInt& exponent);

  BigInt operator-() const {
    if (!big_ && small_ != INT64_MIN) return fromInt64(-small_);

    return negateBeyond();
  }

  BigInt operator~() const {
    if (!big_) return fromInt64(~small_);

    return -(*this) - fromInt64(1);
  }

  friend BigInt operator&(const BigInt& a, const BigInt& b) {
    if (!a.big_ && !b.big_) return fromInt64(a.small_ & b.small_);

    return bitwise(a, b, '&');
  }

  friend BigInt operator|(const BigInt& a, const BigInt& b) {
    if (!a.big_ && !b.big_) return fromInt64(a.small_ | b.small_);

    return bitwise(a, b, '|');
  }

  friend BigInt operator^(const BigInt& a, const BigInt& b) {
    if (!a.big_ && !b.big_) return fromInt64(a.small_ ^ b.small_);

    return bitwise(a, b, '^');
  }

  /// A negative count shifts the other way.
  friend BigInt operator<<(const BigInt& a, const BigInt& count) { return shift(a, count, true); }

  /// Rounds toward negative infinity, as JavaScript's `>>` does.
  friend BigInt operator>>(const BigInt& a, const BigInt& count) { return shift(a, count, false); }

  /// `>>>`: always a TypeError, as in JavaScript.
  [[noreturn]] static BigInt unsignedShiftRight(const BigInt& a, const BigInt& count);

  BigInt& operator+=(const BigInt& b) { return *this = *this + b; }
  BigInt& operator-=(const BigInt& b) { return *this = *this - b; }
  BigInt& operator*=(const BigInt& b) { return *this = *this * b; }
  BigInt& operator/=(const BigInt& b) { return *this = *this / b; }
  BigInt& operator%=(const BigInt& b) { return *this = *this % b; }
  BigInt& operator&=(const BigInt& b) { return *this = *this & b; }
  BigInt& operator|=(const BigInt& b) { return *this = *this | b; }
  BigInt& operator^=(const BigInt& b) { return *this = *this ^ b; }
  BigInt& operator<<=(const BigInt& b) { return *this = *this << b; }
  BigInt& operator>>=(const BigInt& b) { return *this = *this >> b; }

  // --- comparisons ---------------------------------------------------------------

  friend bool operator==(const BigInt& a, const BigInt& b) noexcept {
    if (!a.big_ && !b.big_) return a.small_ == b.small_;

    return equalBeyond(a, b);
  }

  friend std::strong_ordering operator<=>(const BigInt& a, const BigInt& b) noexcept {
    if (!a.big_ && !b.big_) return a.small_ <=> b.small_;

    return compareBeyond(a, b);
  }

  /// `a < b`, `a == b` (loose) and the rest against a number, exactly:
  /// unordered when `b` is NaN.
  friend std::partial_ordering compare(const BigInt& a, double b) noexcept;
  friend std::partial_ordering operator<=>(const BigInt& a, double b) noexcept { return compare(a, b); }
  friend bool operator==(const BigInt& a, double b) noexcept { return compare(a, b) == 0; }

  bool isZero() const noexcept { return !big_ && small_ == 0; }

  /// -1, 0 or 1.
  int sign() const noexcept;

  // --- BigInt.* and conversions -------------------------------------------------------

  /// BigInt.asIntN / BigInt.asUintN. `bits` is converted as ToIndex:
  /// RangeError if negative or beyond 2^53 - 1.
  static BigInt asIntN(double bits, const BigInt& value);
  static BigInt asUintN(double bits, const BigInt& value);

  /// String(x): decimal, without the `n`.
  String toString() const;

  /// x.toString(radix). RangeError unless 2 <= radix <= 36.
  String toString(double radix) const;

  /// Number(x): the nearest double, ties to even (±Infinity beyond range).
  double toDouble() const noexcept;

  /// For a native 64-bit parameter: RangeError when out of range.
  int64_t toInt64() const {
    if (!big_) return small_;

    throwOutOfRange(true);
  }

  uint64_t toUint64() const {
    if (!big_ && small_ >= 0) return static_cast<uint64_t>(small_);

    return toUint64Beyond();
  }

  /// The low 64 bits (BigInt.asIntN(64, x), asUintN(64, x)).
  int64_t wrapToInt64() const noexcept { return static_cast<int64_t>(wrapToUint64()); }

  uint64_t wrapToUint64() const noexcept {
    if (!big_) return static_cast<uint64_t>(small_);

    return wrapBeyond();
  }

  std::optional<int64_t> tryInt64() const noexcept {
    if (!big_) return small_;

    return std::nullopt;
  }

  std::optional<uint64_t> tryUint64() const noexcept;

  /// Equal values hash equal (Map and Set keys).
  size_t hash() const noexcept;

 private:
  /// Beyond int64: a sign and a magnitude in 32-bit limbs, least
  /// significant first, without leading zeros.
  struct Big;

  static BigInt fromUint64Beyond(uint64_t value);
  [[noreturn]] void throwOutOfRange(bool isSigned) const;
  uint64_t toUint64Beyond() const;
  uint64_t wrapBeyond() const noexcept;
  static BigInt add(const BigInt& a, const BigInt& b, bool subtract);
  static BigInt multiply(const BigInt& a, const BigInt& b);
  static BigInt divide(const BigInt& a, const BigInt& b, bool remainder);
  static BigInt bitwise(const BigInt& a, const BigInt& b, char op);
  static BigInt shift(const BigInt& a, const BigInt& count, bool left);
  static bool equalBeyond(const BigInt& a, const BigInt& b) noexcept;
  static std::strong_ordering compareBeyond(const BigInt& a, const BigInt& b) noexcept;
  BigInt negateBeyond() const;

  friend struct BigIntAccess;

  int64_t small_ = 0;
  std::shared_ptr<const Big> big_;
};

/// `===` (and SameValueZero, which is the same for bigints).
inline bool strictEquals(const BigInt& a, const BigInt& b) noexcept { return a == b; }

/// String(x) and template literals.
String toJsString(const BigInt& value);

namespace detail {
[[noreturn]] void throwOutOfNativeRange(const BigInt& value, const char* what, bool isSigned, size_t bits);
}

/// A bigint as the native integer `I` an API takes (the SDK glue: NSInteger,
/// NSUInteger, int64_t, jlong, a struct field's own C type): exactly, or
/// RangeError naming `what`, the parameter or field it is for. The other
/// way needs no helper: BigInt(v) holds every native integer exactly.
template <std::integral I>
  requires(!std::same_as<I, bool>)
I toNativeInteger(const BigInt& value, const char* what) {
  if constexpr (std::is_signed_v<I>) {
    auto v = value.tryInt64();
    if (v && *v >= std::numeric_limits<I>::min() && *v <= std::numeric_limits<I>::max()) return static_cast<I>(*v);
  } else {
    auto v = value.tryUint64();
    if (v && *v <= std::numeric_limits<I>::max()) return static_cast<I>(*v);
  }

  detail::throwOutOfNativeRange(value, what, std::is_signed_v<I>, sizeof(I) * 8);
}

}  // namespace lucent

template <>
struct std::hash<lucent::BigInt> {
  size_t operator()(const lucent::BigInt& v) const noexcept { return v.hash(); }
};

/// A bigint literal beyond int64, parsed once per call site (the compiler
/// emits BigInt::fromInt64 for the others).
#define LUCENT_BIGINT(literal) \
  ([]() -> const ::lucent::BigInt& { static const ::lucent::BigInt v = ::lucent::BigInt::parse(std::string_view(literal)); return v; }())
