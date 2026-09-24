// Lucent runtime — strings with JavaScript semantics.
//
// A String is an immutable sequence of UTF-16 code units, shared by
// reference. Strings whose code units all fit in one byte (Latin-1) are
// stored one byte per unit, the way JavaScript engines do.
#pragma once

#include <atomic>
#include <string>
#include <string_view>
#include <vector>

#include "core.h"

namespace lucent {

class String {
 public:
  String() = default;

  /// Bytes that are all < 0x80, or Latin-1 code units.
  static String fromLatin1(std::string_view bytes);
  /// Takes the buffer instead of copying it (Latin-1, as fromLatin1).
  static String adoptLatin1(std::string&& bytes) { return make(std::move(bytes)); }
  static String fromUtf8(std::string_view utf8);
  static String fromUtf16(const char16_t* units, size_t length);
  static String fromUtf16(std::u16string_view units) { return fromUtf16(units.data(), units.size()); }
  static String fromCodeUnit(char16_t unit);
  /// String.fromCodePoint for one code point.
  static String fromCodePoint(double codePoint);

  size_t length() const { return d_ ? d_->length() : n_; }
  bool empty() const { return length() == 0; }
  /// Unchecked code unit access.
  char16_t unit(size_t i) const {
    if (!d_) return static_cast<unsigned char>(s_[i]);
    return d_->oneByte ? static_cast<unsigned char>(d_->bytes[i]) : d_->wide[i];
  }
  bool isOneByte() const { return !d_ || d_->oneByte; }

  std::string toUtf8() const;
  std::u16string toUtf16() const;
  /// Latin-1 bytes; only valid when isOneByte().
  std::string_view latin1() const { return d_ ? std::string_view(d_->bytes) : std::string_view(s_, n_); }
  /// UTF-16 units; only valid when !isOneByte().
  std::u16string_view utf16() const { return d_ ? std::u16string_view(d_->wide) : std::u16string_view(); }

  // --- JavaScript String.prototype ---------------------------------------
  double charCodeAt(double index) const;
  String charAt(double index) const;
  Opt<String> at(double index) const;
  Opt<double> codePointAt(double index) const;
  double indexOf(const String& search, double from = 0) const;
  double lastIndexOf(const String& search) const;
  double lastIndexOf(const String& search, double from) const;
  bool includes(const String& search, double from = 0) const { return indexOf(search, from) >= 0; }
  bool startsWith(const String& search, double from = 0) const;
  bool endsWith(const String& search) const;
  bool endsWith(const String& search, double endPosition) const;
  String slice(double start) const;
  String slice(double start, double end) const;
  String substring(double start) const;
  String substring(double start, double end) const;
  String toUpperCase() const;
  String toLowerCase() const;
  String trim() const;
  String trimStart() const;
  String trimEnd() const;
  String repeat(double count) const;
  String padStart(double targetLength, const String& fill) const;
  String padEnd(double targetLength, const String& fill) const;
  String replace(const String& search, const String& replacement) const;
  String replaceAll(const String& search, const String& replacement) const;
  String concat(const String& other) const { return *this + other; }
  double localeCompare(const String& other) const;
  String normalize() const { return *this; }

  /// Substring by code unit range, clamped.
  String sub(size_t begin, size_t end) const;
  size_t find(const String& needle, size_t from) const;

  friend String operator+(const String& a, const String& b);
  /// `s += x`. Mutates in place when this handle is the only owner.
  String& operator+=(const String& other);

  friend bool operator==(const String& a, const String& b);
  friend bool operator!=(const String& a, const String& b) { return !(a == b); }
  friend bool operator<(const String& a, const String& b) { return compare(a, b) < 0; }
  friend bool operator>(const String& a, const String& b) { return compare(a, b) > 0; }
  friend bool operator<=(const String& a, const String& b) { return compare(a, b) <= 0; }
  friend bool operator>=(const String& a, const String& b) { return compare(a, b) >= 0; }
  static int compare(const String& a, const String& b);

  size_t hash() const;

 private:
  /// Short Latin-1 strings live in the handle, so the strings most calls
  /// pass (names, keys, words) cost no allocation. make() stores every
  /// one-byte string this short inline: Data holds longer or two-byte ones.
  static constexpr size_t kInline = 15;

  struct Data {
    bool oneByte = true;
    std::string bytes;
    std::u16string wide;
    mutable std::atomic<size_t> hash{0};
    size_t length() const { return oneByte ? bytes.size() : wide.size(); }
  };
  explicit String(std::shared_ptr<Data> d) : d_(std::move(d)) {}
  /// a + b stored inline; the two fit in kInline bytes.
  static String inlined(std::string_view a, std::string_view b);
  static String make(std::string&& latin1);
  static String make(std::u16string&& wide);  // narrows to one byte when possible
  void appendUnitsTo(std::u16string& out) const;

  std::shared_ptr<Data> d_;  // null: the string is inline (n_ bytes of s_)
  uint8_t n_ = 0;
  char s_[kInline] = {};
  friend class StringBuilder;
};

/// A string literal with static storage: built once per call site.
/// Builds a string from parts. With the size reserved up front, the buffer
/// grows once and becomes the result's storage, so building allocates about
/// as much as the result itself.
class StringBuilder {
 public:
  StringBuilder(size_t capacity, bool oneByte);
  void append(const String& s);
  /// Bytes < 0x80 (digits, signs, exponents).
  void appendAscii(std::string_view ascii);
  String build() &&;

 private:
  bool oneByte_;
  std::string bytes_;
  std::u16string wide_;
};

#define LUCENT_STR(literal) \
  ([]() -> const ::lucent::String& { static const ::lucent::String s = ::lucent::String::fromUtf8(std::string_view(literal, sizeof(literal) - 1)); return s; }())
#define LUCENT_STR16(literal) \
  ([]() -> const ::lucent::String& { static const ::lucent::String s = ::lucent::String::fromUtf16(literal, sizeof(literal) / sizeof(char16_t) - 1); return s; }())

bool isJsWhitespace(char16_t c);

}  // namespace lucent

template <>
struct std::hash<lucent::String> {
  size_t operator()(const lucent::String& s) const { return s.hash(); }
};
