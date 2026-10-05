// Lucent runtime — strings with JavaScript semantics.
//
// A String is an immutable sequence of UTF-16 code units, shared by
// reference. Strings whose code units all fit in one byte (Latin-1) are
// stored one byte per unit, the way JavaScript engines do.
#pragma once

#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include "core.h"

namespace lucent {

class String {
 public:
  String() = default;
  String(const String& o) noexcept {
    copyHandle(o);
    if (heap()) retain(data());
  }
  String(String&& o) noexcept {
    copyHandle(o);
    o.clearHandle();
  }
  String& operator=(const String& o) noexcept {
    if (o.heap()) retain(o.data());
    Data* old = heap() ? data() : nullptr;
    copyHandle(o);
    if (old) release(old);
    return *this;
  }
  String& operator=(String&& o) noexcept {
    if (this == &o) return *this;
    Data* old = heap() ? data() : nullptr;
    copyHandle(o);
    o.clearHandle();
    if (old) release(old);
    return *this;
  }
  ~String() {
    if (heap()) release(data());
  }
  /// A handle is its 16 bytes and a reference count it owns: moving it is a
  /// memcpy, so libc++'s vector relocates Strings with memcpy as it grows.
  using __trivially_relocatable = String;

  /// Bytes that are all < 0x80, or Latin-1 code units.
  static String fromLatin1(std::string_view bytes);
  static String fromUtf8(std::string_view utf8);
  /// Narrows to one byte per unit when every unit fits.
  static String fromUtf16(const char16_t* units, size_t length);
  static String fromUtf16(std::u16string_view units) { return fromUtf16(units.data(), units.size()); }
  static String fromCodeUnit(char16_t unit) {
    if (unit > 0xFF) return fromUtf16(&unit, 1);
    String out;
    out.s_[0] = static_cast<char>(unit);
    out.tag_ = 1;
    return out;
  }
  /// String.fromCodePoint for one code point.
  static String fromCodePoint(double codePoint);

  size_t length() const { return heap() ? data()->length : tag_; }
  bool empty() const { return length() == 0; }
  /// Unchecked code unit access.
  char16_t unit(size_t i) const {
    if (!heap()) return static_cast<unsigned char>(s_[i]);
    const Data* d = data();
    return d->oneByte ? static_cast<unsigned char>(d->bytes()[i]) : d->wide()[i];
  }
  bool isOneByte() const { return !heap() || data()->oneByte; }

  std::string toUtf8() const;
  std::u16string toUtf16() const;
  /// Latin-1 bytes; only valid when isOneByte().
  std::string_view latin1() const {
    return heap() ? std::string_view(data()->bytes(), data()->length) : std::string_view(s_, tag_);
  }
  /// UTF-16 units; only valid when !isOneByte().
  std::u16string_view utf16() const {
    return heap() ? std::u16string_view(data()->wide(), data()->length) : std::u16string_view();
  }

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
  /// pass (names, keys, words) cost no allocation. Every one-byte string
  /// this short is stored inline: Data holds longer or two-byte ones.
  static constexpr size_t kInline = 15;
  /// tag_ for a handle that points to Data; otherwise tag_ is the inline length.
  static constexpr uint8_t kHeap = 0xFF;

  /// One allocation: this header, then the code units (one byte each, or
  /// char16_t). Plain fields, so a sole owner can grow it with realloc; the
  /// reference count and the hash are read and written atomically (the
  /// compilers' __atomic builtins: the NDK's libc++ has no std::atomic_ref)
  /// because strings cross threads (compute contexts, the JS thread).
  struct Data {
    uint32_t refs;
    bool oneByte;
    size_t hash;  // 0: not computed yet
    size_t length;
    size_t capacity;  // in code units
    char* bytes() { return reinterpret_cast<char*>(this + 1); }
    const char* bytes() const { return reinterpret_cast<const char*>(this + 1); }
    char16_t* wide() { return reinterpret_cast<char16_t*>(this + 1); }
    const char16_t* wide() const { return reinterpret_cast<const char16_t*>(this + 1); }
  };
  static_assert(sizeof(Data) % alignof(char16_t) == 0);

  bool heap() const { return tag_ == kHeap; }
  Data* data() const {
    Data* d;
    std::memcpy(&d, s_, sizeof d);
    return d;
  }
  void copyHandle(const String& o) {
    std::memcpy(s_, o.s_, sizeof s_);
    tag_ = o.tag_;
  }
  /// The empty string, its bytes zero: an inline string's bytes past its
  /// length are always zero, so two compare as the handles' 16 bytes.
  void clearHandle() {
    std::memset(s_, 0, sizeof s_);
    tag_ = 0;
  }
  static void retain(Data* d) { __atomic_fetch_add(&d->refs, 1, __ATOMIC_RELAXED); }
  static void release(Data* d) {
    if (__atomic_fetch_sub(&d->refs, 1, __ATOMIC_ACQ_REL) == 1) std::free(d);
  }
  /// The only handle to its Data, so `+=` may grow it in place.
  bool unique() const { return __atomic_load_n(&data()->refs, __ATOMIC_ACQUIRE) == 1; }

  /// A new Data with room for `capacity` units and none used yet.
  static Data* allocate(size_t capacity, bool oneByte);
  /// Grows a sole owner's Data to hold at least `capacity` units (amortized).
  static Data* reserve(Data* d, size_t capacity);
  /// A two-byte copy of a one-byte Data, which it frees.
  static Data* widen(Data* d, size_t capacity);
  /// Appends `s` to a sole owner's Data, growing (and widening) it as needed.
  static Data* append(Data* d, const String& s);
  /// Takes ownership of `d` (the reference allocate() returned).
  static String adopt(Data* d);
  /// Writes the code units as UTF-16 to `out` (room for length() units).
  void copyUnitsTo(char16_t* out) const;
  /// a + b stored inline; the two fit in kInline bytes.
  static String inlined(std::string_view a, std::string_view b);
  static String fromBytes(const char* bytes, size_t n);
  static String make(std::string&& latin1) { return fromBytes(latin1.data(), latin1.size()); }
  static String make(std::u16string&& wide) { return fromUtf16(wide.data(), wide.size()); }
  void appendUnitsTo(std::u16string& out) const;

  /// Inline: tag_ bytes of s_, then zeros. Heap: s_ starts with the Data
  /// pointer. Every one-byte string of at most kInline units is inline, so
  /// equal strings are both inline or both on the heap.
  alignas(8) char s_[kInline] = {};
  uint8_t tag_ = 0;
  friend class StringBuilder;
};
static_assert(sizeof(String) == 16);

/// Builds a string from parts, into the storage of the result: with the
/// size reserved up front, building allocates once.
class StringBuilder {
 public:
  StringBuilder(size_t capacity, bool oneByte);
  StringBuilder(const StringBuilder&) = delete;
  StringBuilder& operator=(const StringBuilder&) = delete;
  ~StringBuilder();
  void append(const String& s);
  /// Bytes < 0x80 (digits, signs, exponents).
  void appendAscii(std::string_view ascii);
  String build() &&;

 private:
  String::Data* d_;
};

/// A string literal with static storage: built once per call site.
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
