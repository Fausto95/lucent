// Lucent runtime — Array<T> with JavaScript semantics.
#pragma once

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <memory>
#include <tuple>
#include <variant>
#include <vector>

#include "core.h"
#include "equality.h"
#include "jserror.h"
#include "function.h"
#include "number.h"
#include "jsstring.h"

namespace lucent {

template <class T>
class Array;

template <class T>
String toJsString(const Opt<T>& v);
// Defined in ops.h / helpers.h; declared here so element types that are
// unions or tuples resolve inside Array's templates (ADL only searches std).
template <class... Ts>
String toJsString(const std::variant<Ts...>& v);
template <class... Ts>
String toJsString(const std::tuple<Ts...>& t);

namespace detail {
// JS relative index (used by slice, splice, fill, at...).
inline size_t relativeIndex(double v, size_t len) {
  if (std::isnan(v)) return 0;
  v = std::trunc(v);
  if (v < 0) {
    v += static_cast<double>(len);
    return v < 0 ? 0 : static_cast<size_t>(v);
  }
  return v > static_cast<double>(len) ? len : static_cast<size_t>(v);
}
// Result of a comparator, with NaN treated as 0.
inline double compareResult(double v) { return std::isnan(v) ? 0 : v; }
}  // namespace detail

template <class T>
class Array {
 public:
  /// std::vector<bool> is a bit-packed proxy container; store bytes instead.
  using Elem = std::conditional_t<std::is_same_v<T, bool>, uint8_t, T>;
  using value_type = T;

  Array() : d_(std::make_shared<std::vector<Elem>>()) {}
  Array(std::initializer_list<T> items) : d_(std::make_shared<std::vector<Elem>>()) {
    d_->reserve(items.size());
    for (const auto& v : items) d_->push_back(static_cast<Elem>(v));
  }
  explicit Array(std::vector<Elem> items) : d_(std::make_shared<std::vector<Elem>>(std::move(items))) {}

  /// `new Array(n).fill(v)` style construction.
  static Array filled(size_t n, const T& v) { return Array(std::vector<Elem>(n, static_cast<Elem>(v))); }
  /// `Array.from({ length: n }, (_, i) => f(i))`.
  template <class F>
  static Array generate(double n, F&& f) {
    if (!(n >= 0) || std::trunc(n) != n || n > 4294967295.0) throwRangeError("Invalid array length");
    Array out;
    size_t count = static_cast<size_t>(n);
    out.d_->reserve(count);
    for (size_t i = 0; i < count; i++) out.d_->push_back(static_cast<Elem>(f(static_cast<double>(i))));
    return out;
  }

  size_t size() const { return d_->size(); }
  double length() const { return static_cast<double>(d_->size()); }
  void setLength(double n) {
    if (!(n >= 0) || std::trunc(n) != n || n > 4294967295.0) throwRangeError("Invalid array length");
    size_t len = static_cast<size_t>(n);
    if (len > d_->size()) {
      if constexpr (std::is_default_constructible_v<Elem> && IsOpt<T>::value) {
        d_->resize(len);
      } else {
        throwRangeError("Cannot grow an array of non-optional elements by setting length");
      }
    } else {
      d_->resize(len);
    }
  }

  /// Unchecked element read for compiler-proven in-bounds indexes.
  T at(size_t i) const { return static_cast<T>((*d_)[i]); }
  /// `a[i]` for an index the compiler knows is an integer.
  Opt<T> getIndex(int64_t index) const {
    if (index >= 0 && static_cast<uint64_t>(index) < d_->size()) return static_cast<T>((*d_)[static_cast<size_t>(index)]);
    return undefined;
  }
  /// `a[i]`: undefined when out of bounds.
  Opt<T> get(double index) const {
    if (index >= 0 && index < static_cast<double>(d_->size()) && std::trunc(index) == index) {
      return static_cast<T>((*d_)[static_cast<size_t>(index)]);
    }
    return undefined;
  }
  /// `a[i] = v`. Writing at `length` appends; writing further would create
  /// holes, which Lucent arrays do not have.
  void set(double index, T value) {
    if (!(index >= 0) || std::trunc(index) != index) throwRangeError("Invalid array index");
    size_t i = static_cast<size_t>(index);
    if (i < d_->size()) {
      (*d_)[i] = static_cast<Elem>(std::move(value));
    } else if (i == d_->size()) {
      d_->push_back(static_cast<Elem>(std::move(value)));
    } else {
      if constexpr (IsOpt<T>::value) {
        d_->resize(i);
        d_->push_back(static_cast<Elem>(std::move(value)));
      } else {
        throwRangeError("Array index out of bounds (Lucent arrays cannot have holes)");
      }
    }
  }

  double push(T v) {
    d_->push_back(static_cast<Elem>(std::move(v)));
    return length();
  }
  template <class... Rest>
  double push(T v, Rest&&... rest) {
    push(std::move(v));
    return push(std::forward<Rest>(rest)...);
  }
  Opt<T> pop() {
    if (d_->empty()) return undefined;
    T v = static_cast<T>(std::move(d_->back()));
    d_->pop_back();
    return v;
  }
  Opt<T> shift() {
    if (d_->empty()) return undefined;
    T v = static_cast<T>(std::move(d_->front()));
    d_->erase(d_->begin());
    return v;
  }
  double unshift(T v) {
    d_->insert(d_->begin(), static_cast<Elem>(std::move(v)));
    return length();
  }

  Opt<T> atIndex(double index) const {
    if (std::isnan(index)) index = 0;
    index = std::trunc(index);
    double n = length();
    if (index < 0) index += n;
    if (index < 0 || index >= n) return undefined;
    return at(static_cast<size_t>(index));
  }

  Array slice() const { return Array(*d_); }
  Array slice(double start) const { return slice(start, length()); }
  Array slice(double start, double end) const {
    size_t n = d_->size();
    size_t a = detail::relativeIndex(start, n), b = detail::relativeIndex(end, n);
    if (a >= b) return Array();
    return Array(std::vector<Elem>(d_->begin() + static_cast<std::ptrdiff_t>(a), d_->begin() + static_cast<std::ptrdiff_t>(b)));
  }

  Array splice(double start) { return splice(start, length()); }
  template <class... Items>
  Array splice(double start, double deleteCount, Items&&... items) {
    size_t n = d_->size();
    size_t a = detail::relativeIndex(start, n);
    double dc = std::isnan(deleteCount) ? 0 : std::trunc(deleteCount);
    size_t count = dc <= 0 ? 0 : std::min(static_cast<size_t>(std::min(dc, 4294967295.0)), n - a);
    std::vector<Elem> removed(d_->begin() + static_cast<std::ptrdiff_t>(a), d_->begin() + static_cast<std::ptrdiff_t>(a + count));
    d_->erase(d_->begin() + static_cast<std::ptrdiff_t>(a), d_->begin() + static_cast<std::ptrdiff_t>(a + count));
    std::vector<Elem> inserted{static_cast<Elem>(T(std::forward<Items>(items)))...};
    d_->insert(d_->begin() + static_cast<std::ptrdiff_t>(a), inserted.begin(), inserted.end());
    return Array(std::move(removed));
  }

  Array concat() const { return slice(); }
  template <class... Rest>
  Array concat(const Array& other, const Rest&... rest) const {
    Array out = slice();
    out.d_->insert(out.d_->end(), other.d_->begin(), other.d_->end());
    if constexpr (sizeof...(rest) > 0) return out.concat(rest...);
    return out;
  }
  /// Appends every element of `other` (spread).
  void append(const Array& other) {
    if (other.d_ == d_) {
      std::vector<Elem> copy = *d_;
      d_->insert(d_->end(), copy.begin(), copy.end());
    } else {
      d_->insert(d_->end(), other.d_->begin(), other.d_->end());
    }
  }

  String join() const { return join(String::fromLatin1(",")); }
  String join(const String& sep) const {
    String out;
    for (size_t i = 0; i < d_->size(); i++) {
      if (i > 0) out += sep;
      if constexpr (IsOpt<T>::value) {
        const T& v = (*d_)[i];
        if (v.has()) out += toJsString(v.get());
      } else {
        out += toJsString(at(i));
      }
    }
    return out;
  }

  double indexOf(const T& v, double from = 0) const {
    for (size_t i = detail::relativeIndex(from, d_->size()); i < d_->size(); i++) {
      if (strictEquals(at(i), v)) return static_cast<double>(i);
    }
    return -1;
  }
  double lastIndexOf(const T& v) const {
    for (size_t i = d_->size(); i-- > 0;) {
      if (strictEquals(at(i), v)) return static_cast<double>(i);
    }
    return -1;
  }
  bool includes(const T& v) const {
    for (size_t i = 0; i < d_->size(); i++) {
      if (sameValueZero(at(i), v)) return true;
    }
    return false;
  }

  template <class F>
  Opt<T> find(F&& f) const {
    for (size_t i = 0; i < d_->size(); i++) {
      T v = at(i);
      if (invokeCallback(f, v, static_cast<double>(i), *this)) return v;
    }
    return undefined;
  }
  template <class F>
  double findIndex(F&& f) const {
    for (size_t i = 0; i < d_->size(); i++) {
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) return static_cast<double>(i);
    }
    return -1;
  }
  template <class F>
  Opt<T> findLast(F&& f) const {
    for (size_t i = d_->size(); i-- > 0;) {
      T v = at(i);
      if (invokeCallback(f, v, static_cast<double>(i), *this)) return v;
    }
    return undefined;
  }
  template <class F>
  double findLastIndex(F&& f) const {
    for (size_t i = d_->size(); i-- > 0;) {
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) return static_cast<double>(i);
    }
    return -1;
  }
  template <class F>
  Array filter(F&& f) const {
    Array out;
    size_t n = d_->size();
    for (size_t i = 0; i < n && i < d_->size(); i++) {
      T v = at(i);
      if (invokeCallback(f, v, static_cast<double>(i), *this)) out.d_->push_back(static_cast<Elem>(v));
    }
    return out;
  }
  template <class U, class F>
  Array<U> map(F&& f) const {
    std::vector<typename Array<U>::Elem> out;
    size_t n = d_->size();
    out.reserve(n);
    for (size_t i = 0; i < n && i < d_->size(); i++) {
      out.push_back(static_cast<typename Array<U>::Elem>(U(invokeCallback(f, at(i), static_cast<double>(i), *this))));
    }
    return Array<U>(std::move(out));
  }
  template <class U, class F>
  Array<U> flatMap(F&& f) const {
    Array<U> out;
    size_t n = d_->size();
    for (size_t i = 0; i < n && i < d_->size(); i++) {
      out.append(invokeCallback(f, at(i), static_cast<double>(i), *this));
    }
    return out;
  }
  template <class F>
  void forEach(F&& f) const {
    size_t n = d_->size();
    for (size_t i = 0; i < n && i < d_->size(); i++) invokeCallback(f, at(i), static_cast<double>(i), *this);
  }
  template <class F>
  bool some(F&& f) const {
    size_t n = d_->size();
    for (size_t i = 0; i < n && i < d_->size(); i++) {
      if (invokeCallback(f, at(i), static_cast<double>(i), *this)) return true;
    }
    return false;
  }
  template <class F>
  bool every(F&& f) const {
    size_t n = d_->size();
    for (size_t i = 0; i < n && i < d_->size(); i++) {
      if (!invokeCallback(f, at(i), static_cast<double>(i), *this)) return false;
    }
    return true;
  }
  /// reduce without an initial value: the accumulator is an element.
  template <class F>
  T reduce(F&& f) const {
    if (d_->empty()) throwTypeError("Reduce of empty array with no initial value");
    T acc = at(0);
    size_t n = d_->size();
    for (size_t i = 1; i < n && i < d_->size(); i++) acc = T(invokeCallback(f, acc, at(i), static_cast<double>(i), *this));
    return acc;
  }
  template <class U, class F>
  U reduce(F&& f, U init) const {
    U acc = std::move(init);
    size_t n = d_->size();
    for (size_t i = 0; i < n && i < d_->size(); i++) acc = U(invokeCallback(f, acc, at(i), static_cast<double>(i), *this));
    return acc;
  }
  template <class F>
  T reduceRight(F&& f) const {
    if (d_->empty()) throwTypeError("Reduce of empty array with no initial value");
    size_t i = d_->size() - 1;
    T acc = at(i);
    while (i-- > 0) {
      if (i < d_->size()) acc = T(invokeCallback(f, acc, at(i), static_cast<double>(i), *this));
    }
    return acc;
  }
  template <class U, class F>
  U reduceRight(F&& f, U init) const {
    U acc = std::move(init);
    for (size_t i = d_->size(); i-- > 0;) {
      if (i < d_->size()) acc = U(invokeCallback(f, acc, at(i), static_cast<double>(i), *this));
    }
    return acc;
  }

  /// Default sort: by string value, as JavaScript does; absent values last.
  Array& sort() {
    mergeSort([](const T& a, const T& b) -> double {
      if constexpr (IsOpt<T>::value) {
        if (!a.has() || !b.has()) return (a.has() ? -1.0 : 0.0) + (b.has() ? 1.0 : 0.0);
        return static_cast<double>(String::compare(toJsString(a.get()), toJsString(b.get())));
      } else {
        return static_cast<double>(String::compare(toJsString(a), toJsString(b)));
      }
    });
    return *this;
  }
  template <class F>
  Array& sort(F&& cmp) {
    mergeSort([&](const T& a, const T& b) -> double { return detail::compareResult(cmp(a, b)); });
    return *this;
  }
  Array toSorted() const { return slice().sort(); }
  template <class F>
  Array toSorted(F&& cmp) const {
    Array out = slice();
    out.sort(std::forward<F>(cmp));
    return out;
  }
  Array& reverse() {
    std::reverse(d_->begin(), d_->end());
    return *this;
  }
  Array toReversed() const { return slice().reverse(); }
  Array& fill(const T& v) { return fill(v, 0, length()); }
  Array& fill(const T& v, double start) { return fill(v, start, length()); }
  Array& fill(const T& v, double start, double end) {
    size_t n = d_->size();
    size_t a = detail::relativeIndex(start, n), b = detail::relativeIndex(end, n);
    for (size_t i = a; i < b; i++) (*d_)[i] = static_cast<Elem>(v);
    return *this;
  }

  const void* identity() const { return d_.get(); }
  friend bool strictEquals(const Array& a, const Array& b) { return a.d_ == b.d_; }
  friend String toJsString(const Array& a) { return a.join(); }

  /// Raw storage, for the JSI boundary and for-of loops.
  const std::vector<Elem>& items() const { return *d_; }
  std::vector<Elem>& items() { return *d_; }

 private:
  template <class Cmp>
  void mergeSort(Cmp&& cmp) {
    // Stable, and safe against inconsistent comparators (never reads out of
    // bounds, unlike std::sort).
    std::vector<T> a;
    a.reserve(d_->size());
    for (auto& e : *d_) a.push_back(static_cast<T>(e));
    std::vector<T> tmp(a.size());
    for (size_t width = 1; width < a.size(); width *= 2) {
      for (size_t lo = 0; lo < a.size(); lo += 2 * width) {
        size_t mid = std::min(lo + width, a.size()), hi = std::min(lo + 2 * width, a.size());
        size_t i = lo, j = mid, k = lo;
        while (i < mid && j < hi) {
          if (cmp(a[i], a[j]) > 0) tmp[k++] = a[j++];
          else tmp[k++] = a[i++];
        }
        while (i < mid) tmp[k++] = a[i++];
        while (j < hi) tmp[k++] = a[j++];
      }
      a.swap(tmp);
    }
    d_->clear();
    for (auto& v : a) d_->push_back(static_cast<Elem>(std::move(v)));
  }

  std::shared_ptr<std::vector<Elem>> d_;
};

template <class T>
struct IsArray : std::false_type {};
template <class T>
struct IsArray<Array<T>> : std::true_type {};

template <class T>
String toJsString(const Opt<T>& v) {
  if (v.isUndefined()) return String::fromLatin1("undefined");
  if (v.isNull()) return String::fromLatin1("null");
  return toJsString(v.get());
}

/// String.prototype.split with a string separator.
Array<String> split(const String& s, const String& separator);
Array<String> split(const String& s, const String& separator, double limit);
/// `s.split("")` and `[...s]`-style splitting into code units / code points.
Array<String> splitCodePoints(const String& s);

}  // namespace lucent
