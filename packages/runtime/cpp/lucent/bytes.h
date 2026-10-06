// Lucent runtime — Uint8Array.
#pragma once

#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "array.h"
#include "core.h"
#include "jsstring.h"

namespace lucent {

/// A Uint8Array: a view (offset, length) over a shared byte buffer.
/// `subarray` shares the buffer; `slice` copies, as in JavaScript.
class Bytes {
 public:
  Bytes() : buf_(std::make_shared<std::vector<uint8_t>>()) {}
  explicit Bytes(double length) {
    if (!(length >= 0) || std::trunc(length) != length || length > 2147483647.0) throwRangeError("Invalid typed array length");
    buf_ = std::make_shared<std::vector<uint8_t>>(static_cast<size_t>(length));
    len_ = static_cast<size_t>(length);
  }
  explicit Bytes(std::vector<uint8_t> data) : buf_(std::make_shared<std::vector<uint8_t>>(std::move(data))) { len_ = buf_->size(); }
  static Bytes fromArray(const Array<double>& values) {
    std::vector<uint8_t> out;
    out.reserve(values.size());
    for (double v : values.items()) out.push_back(toUint8(v));
    return Bytes(std::move(out));
  }
  static Bytes copy(const uint8_t* data, size_t n) { return Bytes(std::vector<uint8_t>(data, data + n)); }

  /// A view of `length` bytes at `offset` in `buffer`, which must hold them.
  static Bytes view(std::shared_ptr<std::vector<uint8_t>> buffer, size_t offset, size_t length) {
    return Bytes(std::move(buffer), offset, length);
  }

  /// The buffer this view is over, and where in it the view starts: what a
  /// copy needs to keep views of one buffer sharing theirs (transport.h).
  const std::shared_ptr<std::vector<uint8_t>>& buffer() const { return buf_; }
  size_t offset() const { return off_; }

  static uint8_t toUint8(double v) { return static_cast<uint8_t>(toUint32(v) & 0xFF); }

  size_t size() const { return len_; }
  double length() const { return static_cast<double>(len_); }
  double byteLength() const { return length(); }
  uint8_t* data() { return buf_->data() + off_; }
  const uint8_t* data() const { return buf_->data() + off_; }

  Opt<double> get(double index) const {
    if (index >= 0 && index < static_cast<double>(len_) && std::trunc(index) == index) return static_cast<double>(data()[static_cast<size_t>(index)]);
    return undefined;
  }
  double at(size_t i) const { return static_cast<double>(data()[i]); }
  /// Out-of-range writes are ignored, as for typed arrays in JavaScript.
  void set(double index, double value) {
    if (index >= 0 && index < static_cast<double>(len_) && std::trunc(index) == index) data()[static_cast<size_t>(index)] = toUint8(value);
  }
  void setFrom(const Bytes& src, double offset = 0) {
    size_t o = setOffset(offset, src.len_);
    std::vector<uint8_t> tmp(src.data(), src.data() + src.len_);
    std::copy(tmp.begin(), tmp.end(), data() + o);
  }
  void setFrom(const Array<double>& src, double offset = 0) {
    size_t o = setOffset(offset, src.size());
    for (size_t i = 0; i < src.size(); i++) data()[o + i] = toUint8(src.at(i));
  }
  Bytes subarray(double start) const { return subarray(start, length()); }
  Bytes subarray(double start, double end) const {
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    Bytes v = *this;
    v.off_ = off_ + a;
    v.len_ = b > a ? b - a : 0;
    return v;
  }
  Bytes slice() const { return copy(data(), len_); }
  Bytes slice(double start) const { return slice(start, length()); }
  Bytes slice(double start, double end) const {
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    return b > a ? copy(data() + a, b - a) : Bytes();
  }
  Bytes& fill(double v, double start = 0, double end = kInfinity) {
    size_t a = detail::relativeIndex(start, len_), b = detail::relativeIndex(end, len_);
    if (a < b) std::fill(data() + a, data() + b, toUint8(v));
    return *this;
  }
  double indexOf(double v, double from = 0) const {
    for (size_t i = detail::relativeIndex(from, len_); i < len_; i++) {
      if (static_cast<double>(data()[i]) == v) return static_cast<double>(i);
    }
    return -1;
  }
  bool includes(double v, double from = 0) const { return indexOf(v, from) >= 0; }
  template <class F>
  void forEach(F&& f) const {
    for (size_t i = 0; i < len_; i++) invokeCallback(f, at(i), static_cast<double>(i), *this);
  }
  template <class F>
  Bytes map(F&& f) const {
    std::vector<uint8_t> out(len_);
    for (size_t i = 0; i < len_; i++) out[i] = toUint8(invokeCallback(f, at(i), static_cast<double>(i), *this));
    return Bytes(std::move(out));
  }
  template <class U, class F>
  U reduce(F&& f, U init) const {
    for (size_t i = 0; i < len_; i++) init = U(invokeCallback(f, init, at(i), static_cast<double>(i), *this));
    return init;
  }
  String join(const String& sep = String::fromLatin1(",")) const {
    String out;
    for (size_t i = 0; i < len_; i++) {
      if (i > 0) out += sep;
      out += numberToString(at(i));
    }
    return out;
  }
  Array<double> toArray() const {
    std::vector<double> out(len_);
    for (size_t i = 0; i < len_; i++) out[i] = at(i);
    return Array<double>(std::move(out));
  }

  const void* identity() const { return this->buf_.get(); }

 private:
  Bytes(std::shared_ptr<std::vector<uint8_t>> buffer, size_t offset, size_t length)
      : buf_(std::move(buffer)), off_(offset), len_(length) {}

  /// set()'s offset as an index, checked in double before any cast: NaN is
  /// 0 (ToIntegerOrInfinity), and a source that would run past the end is a
  /// RangeError.
  size_t setOffset(double offset, size_t count) const {
    double o = std::isnan(offset) ? 0 : std::trunc(offset);
    if (o < 0 || o + static_cast<double>(count) > static_cast<double>(len_)) throwRangeError("offset is out of bounds");
    return static_cast<size_t>(o);
  }

  std::shared_ptr<std::vector<uint8_t>> buf_;
  size_t off_ = 0;
  size_t len_ = 0;
};

/// A view is named by its buffer and range, not by the object: two
/// subarray() views of one range are the same view (docs/semantics.md).
inline bool strictEquals(const Bytes& a, const Bytes& b) {
  return a.buffer() == b.buffer() && a.offset() == b.offset() && a.size() == b.size();
}

inline String toJsString(const Bytes& b) { return b.join(); }

/// TextEncoder().encode / TextDecoder().decode for UTF-8.
Bytes utf8Encode(const String& s);
String utf8Decode(const Bytes& b);

}  // namespace lucent
