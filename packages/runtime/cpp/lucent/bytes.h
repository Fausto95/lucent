// Lucent runtime — ArrayBuffer, the typed arrays and DataView.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <memory>
#include <string>
#include <type_traits>
#include <vector>

#include "array.h"
#include "bigint.h"
#include "core.h"
#include "jsstring.h"
#include "number.h"

namespace lucent {

namespace detail {

/// JavaScript's ToIndex: NaN is 0, fractions truncate, and a negative or
/// unsafe index is a RangeError with `message`.
inline size_t toIndex(double v, const char* message) {
  double i = std::isnan(v) ? 0 : std::trunc(v);
  if (i < 0 || i > 9007199254740991.0) throwRangeError(message);
  return static_cast<size_t>(i);
}

}  // namespace detail

/// The bytes an ArrayBuffer holds and its Uint8Arrays view: owned, or
/// adopted from native code (an NSData, a pixel buffer's plane, a
/// NativeBuffer's storage) with the release it needs, which runs once,
/// when the last ArrayBuffer, view or JavaScript ArrayBuffer over them
/// goes. Adopted bytes are never copied to be held. Or lent: JavaScript's
/// own bytes, read in place for one synchronous call.
class ByteStorage {
 public:
  using Release = std::function<void()>;

  ByteStorage() = default;
  explicit ByteStorage(size_t size) : owned_(size) {}
  explicit ByteStorage(std::vector<uint8_t> bytes) : owned_(std::move(bytes)) {}
  ByteStorage(const uint8_t* data, size_t size) : owned_(data, data + size) {}

  /// `size` bytes at `data`, which `release` frees once nothing holds them.
  static std::shared_ptr<ByteStorage> adopt(uint8_t* data, size_t size, Release release) {
    auto s = std::make_shared<ByteStorage>();
    s->external_ = data;
    s->externalSize_ = size;
    s->release_ = std::move(release);
    return s;
  }

  /// `size` bytes at `data` that JavaScript owns, lent for one synchronous
  /// call and read in place: `keep()` makes them a copy before it ends if
  /// anything still holds them.
  static std::shared_ptr<ByteStorage> lend(uint8_t* data, size_t size) {
    auto s = std::make_shared<ByteStorage>();
    s->external_ = size ? data : nullptr;
    s->externalSize_ = s->external_ ? size : 0;
    s->lent_ = true;
    return s;
  }

  ByteStorage(const ByteStorage&) = delete;
  ByteStorage& operator=(const ByteStorage&) = delete;
  ~ByteStorage() {
    if (release_) release_();
  }

  uint8_t* data() { return external_ ? external_ : owned_.data(); }
  const uint8_t* data() const { return external_ ? external_ : owned_.data(); }
  size_t size() const { return external_ ? externalSize_ : owned_.size(); }
  /// Whether the bytes were adopted rather than allocated here.
  bool adopted() const { return external_ != nullptr && !lent_; }
  /// Whether the bytes are JavaScript's, lent for a call (`lend`).
  bool lent() const { return lent_; }
  /// Lent bytes become a copy, owned here, for what still holds them once
  /// the call that lent them ends. Nothing else may use them meanwhile.
  void keep() {
    if (!lent_) return;
    owned_.assign(external_, external_ + externalSize_);
    external_ = nullptr;
    externalSize_ = 0;
    lent_ = false;
  }

 private:
  std::vector<uint8_t> owned_;
  uint8_t* external_ = nullptr;
  size_t externalSize_ = 0;
  Release release_;
  bool lent_ = false;
};

using Storage = std::shared_ptr<ByteStorage>;

/// An ArrayBuffer: the bytes Uint8Arrays view. Copies of it share them, so
/// it is named by its storage: `u8.buffer === u8.buffer`.
class ArrayBuffer {
 public:
  ArrayBuffer() : buf_(std::make_shared<ByteStorage>()) {}
  explicit ArrayBuffer(double length)
      : buf_(std::make_shared<ByteStorage>(detail::toIndex(length, "Invalid array buffer length"))) {}
  explicit ArrayBuffer(Storage storage) : buf_(std::move(storage)) {}
  static ArrayBuffer copy(const uint8_t* data, size_t n) { return ArrayBuffer(std::make_shared<ByteStorage>(data, n)); }

  const Storage& storage() const { return buf_; }
  /// Whether this handle is the only one holding its bytes: no other
  /// ArrayBuffer, view or JavaScript buffer can see them.
  bool unshared() const { return buf_.use_count() == 1; }
  size_t size() const { return buf_->size(); }
  double byteLength() const { return static_cast<double>(buf_->size()); }
  uint8_t* data() { return buf_->data(); }
  const uint8_t* data() const { return buf_->data(); }

  ArrayBuffer slice(double start = 0, double end = kInfinity) const {
    size_t a = detail::relativeIndex(start, size()), b = detail::relativeIndex(end, size());
    return b > a ? copy(data() + a, b - a) : ArrayBuffer();
  }

  const void* identity() const { return buf_.get(); }

 private:
  Storage buf_;
};

inline bool strictEquals(const ArrayBuffer& a, const ArrayBuffer& b) { return a.storage() == b.storage(); }

inline String toJsString(const ArrayBuffer&) { return String::fromLatin1("[object ArrayBuffer]"); }

namespace typed {

// The kinds of typed array: each one's element as stored (`E`), the value
// Lucent code reads and writes (`V`: a number, or a bigint for the 64-bit
// integer kinds), its name, and JavaScript's conversion of a value written
// (ToInt8, ToUint8Clamp, the nearest float…).

struct Int8 {
  using E = int8_t;
  using V = double;
  static constexpr const char* name = "Int8Array";
  static E store(double v) { return static_cast<E>(static_cast<uint8_t>(toUint32(v))); }
  static double load(E e) { return e; }
};
struct Uint8 {
  using E = uint8_t;
  using V = double;
  static constexpr const char* name = "Uint8Array";
  static E store(double v) { return static_cast<E>(toUint32(v) & 0xFF); }
  static double load(E e) { return e; }
};
struct Uint8Clamped {
  using E = uint8_t;
  using V = double;
  static constexpr const char* name = "Uint8ClampedArray";
  /// Clamped to 0..255, rounding half to even; NaN is 0.
  static E store(double v) {
    if (!(v > 0)) return 0;
    if (v >= 255) return 255;
    return static_cast<E>(std::nearbyint(v));
  }
  static double load(E e) { return e; }
};
struct Int16 {
  using E = int16_t;
  using V = double;
  static constexpr const char* name = "Int16Array";
  static E store(double v) { return static_cast<E>(static_cast<uint16_t>(toUint32(v))); }
  static double load(E e) { return e; }
};
struct Uint16 {
  using E = uint16_t;
  using V = double;
  static constexpr const char* name = "Uint16Array";
  static E store(double v) { return static_cast<E>(toUint32(v)); }
  static double load(E e) { return e; }
};
struct Int32 {
  using E = int32_t;
  using V = double;
  static constexpr const char* name = "Int32Array";
  static E store(double v) { return toInt32(v); }
  static double load(E e) { return e; }
};
struct Uint32 {
  using E = uint32_t;
  using V = double;
  static constexpr const char* name = "Uint32Array";
  static E store(double v) { return toUint32(v); }
  static double load(E e) { return e; }
};
struct Float32 {
  using E = float;
  using V = double;
  static constexpr const char* name = "Float32Array";
  static E store(double v) { return static_cast<float>(v); }
  static double load(E e) { return e; }
};
struct Float64 {
  using E = double;
  using V = double;
  static constexpr const char* name = "Float64Array";
  static E store(double v) { return v; }
  static double load(E e) { return e; }
};
struct BigInt64 {
  using E = int64_t;
  using V = BigInt;
  static constexpr const char* name = "BigInt64Array";
  static E store(const BigInt& v) { return v.wrapToInt64(); }
  static BigInt load(E e) { return BigInt::fromInt64(e); }
};
struct BigUint64 {
  using E = uint64_t;
  using V = BigInt;
  static constexpr const char* name = "BigUint64Array";
  static E store(const BigInt& v) { return v.wrapToUint64(); }
  static BigInt load(E e) { return BigInt::fromUint64(e); }
};

/// Equality as `===` has it (NaN is never equal; -0 is 0), and as `includes` (SameValueZero: NaN is NaN).
inline bool strictlyEqual(double a, double b) { return a == b; }
inline bool strictlyEqual(const BigInt& a, const BigInt& b) { return a == b; }
inline bool sameValueZero(double a, double b) { return a == b || (std::isnan(a) && std::isnan(b)); }
inline bool sameValueZero(const BigInt& a, const BigInt& b) { return a == b; }

/// The default sort's order: numbers ascending, -0 before +0, NaN last.
inline bool before(double a, double b) {
  if (std::isnan(a)) return false;
  if (std::isnan(b)) return true;
  if (a == b) return std::signbit(a) && !std::signbit(b);
  return a < b;
}
inline bool before(const BigInt& a, const BigInt& b) { return a < b; }

inline String valueString(double v) { return numberToString(v); }
inline String valueString(const BigInt& v) { return v.toString(); }

}  // namespace typed

/// A typed array: a view (byte offset, length) over a shared byte buffer, of
/// elements of kind K (typed::Int8, typed::Float32…). `subarray` shares the
/// buffer; `slice` copies, as in JavaScript. Elements are read and written
/// through memcpy: adopted bytes need not be aligned.
template <class K>
class TypedArray {
 public:
  using Kind = K;
  using E = typename K::E;
  using V = typename K::V;
  static constexpr size_t kElement = sizeof(E);

  TypedArray() : buf_(std::make_shared<ByteStorage>()) {}
  explicit TypedArray(double length) {
    if (!(length >= 0) || std::trunc(length) != length || length > 2147483647.0 / kElement)
      throwRangeError("Invalid typed array length");
    len_ = static_cast<size_t>(length);
    buf_ = std::make_shared<ByteStorage>(len_ * kElement);
  }
  explicit TypedArray(std::vector<E> items) {
    len_ = items.size();
    if constexpr (kElement == 1) {
      std::vector<uint8_t> bytes(items.size());
      if (!items.empty()) std::memcpy(bytes.data(), items.data(), items.size());
      buf_ = std::make_shared<ByteStorage>(std::move(bytes));
    } else {
      buf_ = std::make_shared<ByteStorage>(reinterpret_cast<const uint8_t*>(items.data()), items.size() * kElement);
    }
  }
  static TypedArray fromArray(const Array<V>& values) {
    std::vector<E> out;
    out.reserve(values.size());
    for (const auto& v : values.items()) out.push_back(K::store(static_cast<V>(v)));
    return TypedArray(std::move(out));
  }
  /// `new X(other)`: another typed array's values, converted.
  template <class K2>
  static TypedArray fromTyped(const TypedArray<K2>& other) {
    static_assert(std::is_same_v<typename K2::V, V>, "a typed array of bigints and one of numbers do not convert");
    std::vector<E> out(other.size());
    for (size_t i = 0; i < other.size(); i++) out[i] = K::store(other.at(i));
    return TypedArray(std::move(out));
  }
  /// `n` elements at `data`, copied.
  static TypedArray copy(const E* data, size_t n) { return TypedArray(std::vector<E>(data, data + n)); }

  /// `new X(buffer, byteOffset?, length?)`: a view of `buffer`'s bytes from
  /// `byteOffset`, which is a multiple of the element's size, to its end
  /// (which must be one too) unless `length` is given.
  static TypedArray over(const ArrayBuffer& buffer, Opt<double> byteOffset = undefined, Opt<double> length = undefined) {
    size_t offset = byteOffset.has() ? detail::toIndex(byteOffset.get(), "Start offset is outside the bounds of the buffer") : 0;
    if (offset % kElement) throwRangeError(misaligned("start offset").c_str());
    size_t size = buffer.size();
    if (!length.has()) {
      if (offset > size) throwRangeError("Start offset is outside the bounds of the buffer");
      if ((size - offset) % kElement) throwRangeError(misaligned("byte length").c_str());
      return TypedArray(buffer.storage(), offset, (size - offset) / kElement);
    }
    size_t n = detail::toIndex(length.get(), "Invalid typed array length");
    if (offset > size || n > (size - offset) / kElement) throwRangeError("Invalid typed array length");
    return TypedArray(buffer.storage(), offset, n);
  }

  /// The whole buffer this view is over (`a.buffer`), and where it starts in it.
  ArrayBuffer arrayBuffer() const { return ArrayBuffer(buf_); }
  double byteOffset() const { return static_cast<double>(off_); }

  /// A view of `length` elements at byte `offset` in `buffer`, which must hold them.
  static TypedArray view(Storage buffer, size_t offset, size_t length) {
    return TypedArray(std::move(buffer), offset, length);
  }

  /// The buffer this view is over, and the byte where it starts in it: what
  /// a copy needs to keep views of one buffer sharing theirs (transport.h).
  const Storage& buffer() const { return buf_; }
  size_t offset() const { return off_; }

  /// Uint8Array's conversion of a value written (ToUint8).
  static uint8_t toUint8(double v) { return typed::Uint8::store(v); }

  /// Its elements.
  size_t size() const { return len_; }
  double length() const { return static_cast<double>(len_); }
  double byteLength() const { return static_cast<double>(len_ * kElement); }
  /// Its first byte.
  uint8_t* data() { return buf_->data() + off_; }
  const uint8_t* data() const { return buf_->data() + off_; }

  /// Element `i`, which must be below size().
  V at(size_t i) const { return K::load(raw(i)); }
  E raw(size_t i) const {
    if constexpr (kElement == 1) {
      return static_cast<E>(data()[i]);
    } else {
      E e;
      std::memcpy(&e, data() + i * kElement, kElement);
      return e;
    }
  }
  void put(size_t i, E e) {
    if constexpr (kElement == 1)
      data()[i] = static_cast<uint8_t>(e);
    else
      std::memcpy(data() + i * kElement, &e, kElement);
  }

  Opt<V> get(double index) const {
    size_t i = indexBelow(index, len_);
    if (i != kNoIndex) return at(i);
    return undefined;
  }
  /// `a.at(i)`: from the end for a negative index.
  Opt<V> atIndex(double index) const {
    double i = std::isnan(index) ? 0 : std::trunc(index);
    if (i < 0) i += length();
    if (!(i >= 0) || i >= length()) return undefined;
    return at(static_cast<size_t>(i));
  }
  /// Out-of-range writes are ignored, as for typed arrays in JavaScript.
  void set(double index, const V& value) {
    size_t i = indexBelow(index, len_);
    E e = K::store(value);
    if (i != kNoIndex) put(i, e);
  }
  /// `a.set(source, offset)`: another typed array's values (of any kind of
  /// the same value type), or an array's, from element `offset`.
  template <class K2>
  void setFrom(const TypedArray<K2>& src, double offset = 0) {
    static_assert(std::is_same_v<typename K2::V, V>, "a typed array of bigints and one of numbers do not convert");
    size_t o = setOffset(offset, src.size());
    std::vector<E> tmp(src.size());
    for (size_t i = 0; i < src.size(); i++) tmp[i] = K::store(src.at(i));
    for (size_t i = 0; i < tmp.size(); i++) put(o + i, tmp[i]);
  }
  void setFrom(const Array<V>& src, double offset = 0) {
    size_t o = setOffset(offset, src.size());
    for (size_t i = 0; i < src.size(); i++) put(o + i, K::store(src.at(i)));
  }
  TypedArray subarray(double start) const { return subarray(start, length()); }
  TypedArray subarray(double start, double end) const {
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    TypedArray v = *this;
    v.off_ = off_ + a * kElement;
    v.len_ = b > a ? b - a : 0;
    return v;
  }
  TypedArray slice() const { return slice(0, length()); }
  TypedArray slice(double start) const { return slice(start, length()); }
  TypedArray slice(double start, double end) const {
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    if (b <= a) return TypedArray();
    TypedArray out(static_cast<double>(b - a));
    std::memcpy(out.data(), data() + a * kElement, (b - a) * kElement);
    return out;
  }
  TypedArray& fill(const V& v, double start = 0, double end = kInfinity) {
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    E e = K::store(v);
    for (size_t i = a; i < b; i++) put(i, e);
    return *this;
  }
  TypedArray& copyWithin(double target, double start, double end = kInfinity) {
    size_t to = detail::relativeIndex(target, len_);
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    size_t n = b > a ? std::min(b - a, len_ - to) : 0;
    if (n) std::memmove(data() + to * kElement, data() + a * kElement, n * kElement);
    return *this;
  }
  TypedArray& reverse() {
    for (size_t i = 0, j = len_; i + 1 < j; i++, j--) {
      E x = raw(i);
      put(i, raw(j - 1));
      put(j - 1, x);
    }
    return *this;
  }
  TypedArray toReversed() const { return slice().reverse(); }
  /// The default sort: numbers ascending, -0 before +0, NaN last.
  TypedArray& sort() {
    return sortBy([](const V& a, const V& b) { return typed::before(a, b); });
  }
  /// `cmp(a, b) < 0` puts `a` first; NaN is 0. Stable.
  template <class F>
  TypedArray& sort(F&& cmp) {
    return sortBy([&](const V& a, const V& b) { return detail::compareResult(static_cast<double>(cmp(a, b))) < 0; });
  }
  TypedArray toSorted() const { return slice().sort(); }
  template <class F>
  TypedArray toSorted(F&& cmp) const {
    TypedArray out = slice();
    out.sort(std::forward<F>(cmp));
    return out;
  }
  /// `a.with(i, v)`: a copy with element `i` (from the end when negative) replaced.
  TypedArray with(double index, const V& value) const {
    double i = std::isnan(index) ? 0 : std::trunc(index);
    if (i < 0) i += length();
    E e = K::store(value);
    if (!(i >= 0) || i >= length()) throwRangeError("Invalid typed array index");
    TypedArray out = slice();
    out.put(static_cast<size_t>(i), e);
    return out;
  }

  double indexOf(const V& v, double from = 0) const {
    for (size_t i = detail::relativeIndex(from, len_); i < len_; i++)
      if (typed::strictlyEqual(at(i), v)) return static_cast<double>(i);
    return -1;
  }
  double lastIndexOf(const V& v) const { return lastIndexOf(v, length() - 1); }
  double lastIndexOf(const V& v, double from) const {
    double f = std::isnan(from) ? 0 : std::trunc(from);
    if (f < 0) f += length();
    if (f < 0) return -1;
    size_t end = f >= length() ? len_ : static_cast<size_t>(f) + 1;
    for (size_t i = end; i-- > 0;)
      if (typed::strictlyEqual(at(i), v)) return static_cast<double>(i);
    return -1;
  }
  bool includes(const V& v, double from = 0) const {
    for (size_t i = detail::relativeIndex(from, len_); i < len_; i++)
      if (typed::sameValueZero(at(i), v)) return true;
    return false;
  }

  template <class F>
  void forEach(F&& f) const {
    for (size_t i = 0; i < len_; i++) invokeCallback(f, at(i), static_cast<double>(i), *this);
  }
  template <class F>
  TypedArray map(F&& f) const {
    std::vector<E> out(len_);
    for (size_t i = 0; i < len_; i++) out[i] = K::store(V(invokeCallback(f, at(i), static_cast<double>(i), *this)));
    return TypedArray(std::move(out));
  }
  template <class F>
  TypedArray filter(F&& f) const {
    std::vector<E> out;
    for (size_t i = 0; i < len_; i++)
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) out.push_back(raw(i));
    return TypedArray(std::move(out));
  }
  template <class F>
  bool some(F&& f) const {
    for (size_t i = 0; i < len_; i++)
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) return true;
    return false;
  }
  template <class F>
  bool every(F&& f) const {
    for (size_t i = 0; i < len_; i++)
      if (!invokeCallback(f, at(i), static_cast<double>(i), *this)) return false;
    return true;
  }
  template <class F>
  Opt<V> find(F&& f) const {
    for (size_t i = 0; i < len_; i++) {
      V v = at(i);
      if (invokeCallback(f, v, static_cast<double>(i), *this)) return v;
    }
    return undefined;
  }
  template <class F>
  double findIndex(F&& f) const {
    for (size_t i = 0; i < len_; i++)
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) return static_cast<double>(i);
    return -1;
  }
  template <class F>
  Opt<V> findLast(F&& f) const {
    for (size_t i = len_; i-- > 0;) {
      V v = at(i);
      if (invokeCallback(f, v, static_cast<double>(i), *this)) return v;
    }
    return undefined;
  }
  template <class F>
  double findLastIndex(F&& f) const {
    for (size_t i = len_; i-- > 0;)
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) return static_cast<double>(i);
    return -1;
  }
  template <class F>
  V reduce(F&& f) const {
    if (!len_) throwTypeError("Reduce of empty array with no initial value");
    V acc = at(0);
    for (size_t i = 1; i < len_; i++) acc = V(invokeCallback(f, acc, at(i), static_cast<double>(i), *this));
    return acc;
  }
  template <class U, class F>
  U reduce(F&& f, U init) const {
    for (size_t i = 0; i < len_; i++) init = U(invokeCallback(f, init, at(i), static_cast<double>(i), *this));
    return init;
  }
  template <class F>
  V reduceRight(F&& f) const {
    if (!len_) throwTypeError("Reduce of empty array with no initial value");
    V acc = at(len_ - 1);
    for (size_t i = len_ - 1; i-- > 0;) acc = V(invokeCallback(f, acc, at(i), static_cast<double>(i), *this));
    return acc;
  }
  template <class U, class F>
  U reduceRight(F&& f, U init) const {
    for (size_t i = len_; i-- > 0;) init = U(invokeCallback(f, init, at(i), static_cast<double>(i), *this));
    return init;
  }
  String join(const String& sep = String::fromLatin1(",")) const {
    String out;
    for (size_t i = 0; i < len_; i++) {
      if (i > 0) out += sep;
      out += typed::valueString(at(i));
    }
    return out;
  }
  Array<V> toArray() const {
    std::vector<V> out;
    out.reserve(len_);
    for (size_t i = 0; i < len_; i++) out.push_back(at(i));
    return Array<V>(std::move(out));
  }

  const void* identity() const { return this->buf_.get(); }

 private:
  TypedArray(Storage buffer, size_t offset, size_t length) : buf_(std::move(buffer)), off_(offset), len_(length) {}

  static std::string misaligned(const char* what) {
    return std::string(what) + " of " + K::name + " should be a multiple of " + std::to_string(kElement);
  }

  /// set()'s offset as an index, checked in double before any cast: NaN is
  /// 0 (ToIntegerOrInfinity), and a source that would run past the end is a
  /// RangeError.
  size_t setOffset(double offset, size_t count) const {
    double o = std::isnan(offset) ? 0 : std::trunc(offset);
    if (o < 0 || o + static_cast<double>(count) > static_cast<double>(len_)) throwRangeError("offset is out of bounds");
    return static_cast<size_t>(o);
  }

  /// A stable merge sort by `less`, safe against inconsistent comparators.
  template <class Less>
  TypedArray& sortBy(Less&& less) {
    std::vector<V> a;
    a.reserve(len_);
    for (size_t i = 0; i < len_; i++) a.push_back(at(i));
    std::vector<V> tmp(a.size());
    for (size_t width = 1; width < a.size(); width *= 2) {
      for (size_t lo = 0; lo < a.size(); lo += 2 * width) {
        size_t mid = std::min(lo + width, a.size()), hi = std::min(lo + 2 * width, a.size());
        size_t i = lo, j = mid, k = lo;
        while (i < mid && j < hi) tmp[k++] = less(a[j], a[i]) ? a[j++] : a[i++];
        while (i < mid) tmp[k++] = a[i++];
        while (j < hi) tmp[k++] = a[j++];
      }
      std::swap(a, tmp);
    }
    for (size_t i = 0; i < a.size(); i++) put(i, K::store(a[i]));
    return *this;
  }

  Storage buf_;
  size_t off_ = 0;
  size_t len_ = 0;
};

/// A Uint8Array.
using Bytes = TypedArray<typed::Uint8>;
using Uint8Array = Bytes;
using Int8Array = TypedArray<typed::Int8>;
using Uint8ClampedArray = TypedArray<typed::Uint8Clamped>;
using Int16Array = TypedArray<typed::Int16>;
using Uint16Array = TypedArray<typed::Uint16>;
using Int32Array = TypedArray<typed::Int32>;
using Uint32Array = TypedArray<typed::Uint32>;
using Float32Array = TypedArray<typed::Float32>;
using Float64Array = TypedArray<typed::Float64>;
using BigInt64Array = TypedArray<typed::BigInt64>;
using BigUint64Array = TypedArray<typed::BigUint64>;

/// A view is named by its buffer and range, not by the object: two
/// subarray() views of one range are the same view (docs/semantics.md).
template <class K>
bool strictEquals(const TypedArray<K>& a, const TypedArray<K>& b) {
  return a.buffer() == b.buffer() && a.offset() == b.offset() && a.size() == b.size();
}

template <class K>
String toJsString(const TypedArray<K>& a) {
  return a.join();
}

template <class T>
struct IsTypedArray : std::false_type {};
template <class K>
struct IsTypedArray<TypedArray<K>> : std::true_type {};

/// `DataView`: a view of a buffer's bytes read and written as any number
/// type, in either byte order (big-endian unless `littleEndian`).
class DataView {
 public:
  DataView() : buf_(std::make_shared<ByteStorage>()) {}

  /// `new DataView(buffer, byteOffset?, byteLength?)`.
  static DataView over(const ArrayBuffer& buffer, Opt<double> byteOffset = undefined, Opt<double> byteLength = undefined) {
    size_t offset = byteOffset.has() ? detail::toIndex(byteOffset.get(), "Start offset is outside the bounds of the buffer") : 0;
    size_t size = buffer.size();
    if (offset > size) throwRangeError("Start offset is outside the bounds of the buffer");
    if (!byteLength.has()) return DataView(buffer.storage(), offset, size - offset);
    size_t n = detail::toIndex(byteLength.get(), "Invalid DataView length");
    if (n > size - offset) throwRangeError("Invalid DataView length");
    return DataView(buffer.storage(), offset, n);
  }

  ArrayBuffer buffer() const { return ArrayBuffer(buf_); }
  double byteOffset() const { return static_cast<double>(off_); }
  double byteLength() const { return static_cast<double>(len_); }
  const Storage& storage() const { return buf_; }
  size_t offset() const { return off_; }
  size_t size() const { return len_; }

  double getInt8(double at) const { return typed::Int8::load(load<int8_t>(at, false)); }
  double getUint8(double at) const { return load<uint8_t>(at, false); }
  double getInt16(double at, bool little = false) const { return load<int16_t>(at, little); }
  double getUint16(double at, bool little = false) const { return load<uint16_t>(at, little); }
  double getInt32(double at, bool little = false) const { return load<int32_t>(at, little); }
  double getUint32(double at, bool little = false) const { return load<uint32_t>(at, little); }
  double getFloat32(double at, bool little = false) const { return load<float>(at, little); }
  double getFloat64(double at, bool little = false) const { return load<double>(at, little); }
  BigInt getBigInt64(double at, bool little = false) const { return BigInt::fromInt64(load<int64_t>(at, little)); }
  BigInt getBigUint64(double at, bool little = false) const { return BigInt::fromUint64(load<uint64_t>(at, little)); }

  void setInt8(double at, double v) { store(at, typed::Int8::store(v), false); }
  void setUint8(double at, double v) { store(at, typed::Uint8::store(v), false); }
  void setInt16(double at, double v, bool little = false) { store(at, typed::Int16::store(v), little); }
  void setUint16(double at, double v, bool little = false) { store(at, typed::Uint16::store(v), little); }
  void setInt32(double at, double v, bool little = false) { store(at, typed::Int32::store(v), little); }
  void setUint32(double at, double v, bool little = false) { store(at, typed::Uint32::store(v), little); }
  void setFloat32(double at, double v, bool little = false) { store(at, typed::Float32::store(v), little); }
  void setFloat64(double at, double v, bool little = false) { store(at, v, little); }
  void setBigInt64(double at, const BigInt& v, bool little = false) { store(at, v.wrapToInt64(), little); }
  void setBigUint64(double at, const BigInt& v, bool little = false) { store(at, v.wrapToUint64(), little); }

  const void* identity() const { return this; }

 private:
  DataView(Storage buffer, size_t offset, size_t length) : buf_(std::move(buffer)), off_(offset), len_(length) {}

  /// The byte `at` (ToIndex) starts a value of `n` bytes inside the view.
  size_t place(double at, size_t n) const {
    size_t i = detail::toIndex(at, "Offset is outside the bounds of the DataView");
    if (i > len_ || n > len_ - i) throwRangeError("Offset is outside the bounds of the DataView");
    return off_ + i;
  }

  /// The host is little-endian (every target Lucent builds for).
  template <class T>
  T load(double at, bool little) const {
    uint8_t bytes[sizeof(T)];
    std::memcpy(bytes, buf_->data() + place(at, sizeof(T)), sizeof(T));
    if (!little) std::reverse(bytes, bytes + sizeof(T));
    T v;
    std::memcpy(&v, bytes, sizeof(T));
    return v;
  }
  template <class T>
  void store(double at, T v, bool little) {
    size_t i = place(at, sizeof(T));
    uint8_t bytes[sizeof(T)];
    std::memcpy(bytes, &v, sizeof(T));
    if (!little) std::reverse(bytes, bytes + sizeof(T));
    std::memcpy(buf_->data() + i, bytes, sizeof(T));
  }

  Storage buf_;
  size_t off_ = 0;
  size_t len_ = 0;
};

inline bool strictEquals(const DataView& a, const DataView& b) { return a.identity() == b.identity(); }

inline String toJsString(const DataView&) { return String::fromLatin1("[object DataView]"); }

/// TextEncoder().encode / TextDecoder().decode for UTF-8.
Bytes utf8Encode(const String& s);
String utf8Decode(const Bytes& b);

template <class T>
using IsBytes = std::is_same<T, Bytes>;
template <class T>
using IsArrayBuffer = std::is_same<T, ArrayBuffer>;

}  // namespace lucent
