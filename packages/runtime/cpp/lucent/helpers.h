// Lucent runtime — small helpers the compiler emits calls to.
#pragma once

#include <chrono>
#include <cmath>
#include <initializer_list>
#include <tuple>
#include <variant>

#include "array.h"
#include "async.h"
#include "bytes.h"
#include "core.h"
#include "error.h"
#include "map.h"
#include "number.h"
#include "ops.h"
#include "string.h"

namespace lucent {

/// `this` as a strong reference, inside a member function.
template <class T>
Ref<T> selfRef(T* p) {
  return std::static_pointer_cast<T>(static_cast<Object*>(p)->shared_from_this());
}
template <class T>
Ref<T> selfRef(const T* p) {
  return selfRef(const_cast<T*>(p));
}

// --- element access for compound assignment ------------------------------------------

template <class T>
T elementAt(const Array<T>& a, double i) {
  Opt<T> v = a.get(i);
  if (!v.has()) throwRangeError("Array index out of bounds");
  return v.get();
}
template <class T, class V>
T setElement(Array<T>& a, double i, V&& v) {
  T value(std::forward<V>(v));
  a.set(i, value);
  return value;
}
template <class T, class V>
T setElement(const Array<T>& a, double i, V&& v) {
  Array<T> copy = a;
  return setElement(copy, i, std::forward<V>(v));
}
inline double elementAt(const Bytes& b, double i) {
  Opt<double> v = b.get(i);
  if (!v.has()) throwRangeError("Uint8Array index out of bounds");
  return v.get();
}
inline double setElement(const Bytes& b, double i, double v) {
  Bytes copy = b;
  copy.set(i, v);
  return v;
}
template <class V>
V entryAt(const Dict<V>& d, const String& k) {
  Opt<V> v = d.get(k);
  if (!v.has()) throwTypeError("Record has no such key");
  return v.get();
}
template <class V, class X>
V setEntry(const Dict<V>& d, const String& k, X&& v) {
  Dict<V> copy = d;
  V value(std::forward<X>(v));
  copy.set(k, value);
  return value;
}
template <class V>
void assignEntries(Dict<V>& target, const Dict<V>& source) {
  Array<String> ks = source.keys();
  for (const auto& k : ks.items()) target.set(k, source.get(k).get());
}

/// `s[i]`: undefined when out of range (unlike `s.at(i)`, no negative indexes).
inline Opt<String> stringIndex(const String& s, double i) {
  if (i >= 0 && i < static_cast<double>(s.length()) && std::trunc(i) == i) return String::fromCodeUnit(s.unit(static_cast<size_t>(i)));
  return undefined;
}

// --- instanceof ---------------------------------------------------------------------------

template <class C, class V>
bool isInstance(const V& v) {
  if constexpr (IsRef<V>::value) {
    return std::dynamic_pointer_cast<C>(v) != nullptr;
  } else if constexpr (IsOpt<V>::value) {
    return v.has() && isInstance<C>(v.get());
  } else if constexpr (IsVariant<V>::value) {
    return std::visit([](const auto& x) { return isInstance<C>(x); }, v);
  } else {
    return false;
  }
}

/// `e instanceof Error` / `TypeError` / `RangeError` (kind null = any error).
template <class V>
bool isErrorOf(const V& v, const char* kind) {
  if constexpr (std::is_same_v<V, Error>) {
    return v && (kind == nullptr || v->name == String::fromLatin1(kind));
  } else if constexpr (IsRef<V>::value) {
    auto e = std::dynamic_pointer_cast<ErrorObject>(v);
    return e && (kind == nullptr || e->name == String::fromLatin1(kind));
  } else if constexpr (IsOpt<V>::value) {
    return v.has() && isErrorOf(v.get(), kind);
  } else if constexpr (IsVariant<V>::value) {
    return std::visit([kind](const auto& x) { return isErrorOf(x, kind); }, v);
  } else {
    return false;
  }
}

/// Checked downcast after `instanceof` narrowing.
template <class C, class V>
Ref<C> downcast(const Ref<V>& v) {
  auto r = std::dynamic_pointer_cast<C>(v);
  if (!r) throwTypeError("Value is not an instance of the expected class");
  return r;
}

inline Error errorWithCode(const String& code, const String& message) {
  Error e = makeError(message);
  e->code = code;
  return e;
}

// --- time ------------------------------------------------------------------------------------

inline double dateNow() {
  return static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
}
inline double monotonicNow() {
  return static_cast<double>(std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count()) / 1000.0;
}

// --- strings ----------------------------------------------------------------------------------

inline String stringFromCharCodes(std::initializer_list<double> codes) {
  std::u16string out;
  for (double c : codes) out.push_back(static_cast<char16_t>(toUint32(c) & 0xFFFF));
  return String::fromUtf16(out);
}
inline String stringFromCodePoints(std::initializer_list<double> cps) {
  String out;
  for (double c : cps) out += String::fromCodePoint(c);
  return out;
}

// --- Math.min(...xs) ------------------------------------------------------------------------

namespace math {
inline double minOf(const Array<double>& xs) {
  double r = kInfinity;
  for (double v : xs.items()) r = min(r, v);
  return r;
}
inline double maxOf(const Array<double>& xs) {
  double r = -kInfinity;
  for (double v : xs.items()) r = max(r, v);
  return r;
}
}  // namespace math

// --- entries --------------------------------------------------------------------------------

template <class V>
Array<std::tuple<String, V>> dictEntries(const Dict<V>& d) {
  Array<std::tuple<String, V>> out;
  Array<String> ks = d.keys();
  for (const auto& k : ks.items()) out.push(std::tuple<String, V>(k, d.get(k).get()));
  return out;
}
template <class V>
Dict<V> dictFromEntries(const Array<std::tuple<String, V>>& entries) {
  Dict<V> out;
  for (const auto& e : entries.items()) out.set(std::get<0>(e), std::get<1>(e));
  return out;
}
template <class K, class V>
Array<std::tuple<K, V>> mapEntries(const Map<K, V>& m) {
  Array<std::tuple<K, V>> out;
  auto& t = m.table();
  for (size_t i = 0; i < t.slotCount(); i++) {
    if (t.slotLive(i)) out.push(std::tuple<K, V>(t.slot(i).key, t.slot(i).value));
  }
  return out;
}
template <class K, class V>
Map<K, V> mapFromEntries(const Array<std::tuple<K, V>>& entries) {
  Map<K, V> out;
  for (const auto& e : entries.items()) out.set(std::get<0>(e), std::get<1>(e));
  return out;
}
template <class T>
Array<std::tuple<double, T>> arrayEntries(const Array<T>& a) {
  Array<std::tuple<double, T>> out;
  for (size_t i = 0; i < a.size(); i++) out.push(std::tuple<double, T>(static_cast<double>(i), a.at(i)));
  return out;
}

// --- tuples ---------------------------------------------------------------------------------------

template <class... Ts>
String toJsString(const std::tuple<Ts...>& t) {
  String out;
  size_t i = 0;
  std::apply(
      [&](const auto&... x) {
        ((out += (i++ ? String::fromLatin1(",") : String()), out += toJsString(x)), ...);
      },
      t);
  return out;
}
template <class... Ts>
bool strictEquals(const std::tuple<Ts...>& a, const std::tuple<Ts...>& b) {
  // Tuples are values in Lucent; compare element-wise.
  return std::apply([&](const auto&... x) { return std::apply([&](const auto&... y) { return (strictEquals(x, y) && ...); }, b); }, a);
}

}  // namespace lucent
