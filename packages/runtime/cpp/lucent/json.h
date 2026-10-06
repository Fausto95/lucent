// Lucent runtime — JSON.stringify for Lucent values. Generated code adds
// `jsonWrite` overloads for each struct (and `jsonValue` for one with a
// toJSON property; found by ADL) and a `lucentJson_` member to each class.
#pragma once

#include <cmath>
#include <concepts>
#include <cstddef>
#include <string>
#include <tuple>
#include <variant>

#include "array.h"
#include "async.h"
#include "bigint.h"
#include "bytes.h"
#include "date.h"
#include "regexp.h"
#include "core.h"
#include "jserror.h"
#include "function.h"
#include "map.h"
#include "native.h"
#include "number.h"
#include "jsstring.h"

namespace lucent {

struct JsonWriter {
  std::u16string out;
  void raw(const char* s) {
    while (*s) out.push_back(static_cast<unsigned char>(*s++));
  }
  void quote(const String& s);
};

/// A Lucent class: its virtual `lucentJson_(w, toJson)` writes the instance
/// as its own class, toJSON's value when `toJson` is set, and returns false
/// when that value is omitted.
template <class C>
concept JsonClass = requires(C& c, JsonWriter& w) {
  { c.lucentJson_(w, true) } -> std::same_as<bool>;
};

// The overloads the containers below call, declared first: a Ref's
// associated namespaces do not include lucent.
template <class T>
bool jsonValue(JsonWriter& w, const T& v);
template <class T>
bool jsonValue(JsonWriter& w, const Opt<T>& v);
template <class... Ts>
bool jsonValue(JsonWriter& w, const std::variant<Ts...>& v);
template <JsonClass C>
bool jsonValue(JsonWriter& w, const Ref<C>& v);
template <JsonClass C>
void jsonWrite(JsonWriter& w, const Ref<C>& v);

/// Whether a value is omitted from objects (undefined, functions).
template <class T>
bool jsonOmitted(const T&) {
  return false;
}
inline bool jsonOmitted(Undefined) { return true; }
template <class T>
bool jsonOmitted(const Opt<T>& v) {
  return v.isUndefined();
}
template <class Sig>
bool jsonOmitted(const Fn<Sig>&) {
  return true;
}

inline void jsonWrite(JsonWriter& w, double v) {
  if (std::isfinite(v)) {
    w.out.append(numberToString(v).toUtf16());
  } else {
    w.raw("null");
  }
}
inline void jsonWrite(JsonWriter& w, bool v) { w.raw(v ? "true" : "false"); }
/// JSON has no bigints: JSON.stringify throws, as in JavaScript.
inline void jsonWrite(JsonWriter&, const BigInt&) { throwTypeError("Do not know how to serialize a BigInt"); }
inline void jsonWrite(JsonWriter& w, const String& s) { w.quote(s); }
inline void jsonWrite(JsonWriter& w, Undefined) { w.raw("null"); }
inline void jsonWrite(JsonWriter& w, Null) { w.raw("null"); }
inline void jsonWrite(JsonWriter& w, const Error&) { w.raw("{}"); }
/// An SDK object: a host object, with no enumerable own properties.
inline void jsonWrite(JsonWriter& w, const NativeRef&) { w.raw("{}"); }
class NativeBufferObject;
/// A NativeBuffer: an opaque handle, with no enumerable own properties either.
inline void jsonWrite(JsonWriter& w, const Ref<NativeBufferObject>&) { w.raw("{}"); }
/// A promise: no enumerable own properties.
template <class T>
void jsonWrite(JsonWriter& w, const Promise<T>&) {
  w.raw("{}");
}
template <class Sig>
void jsonWrite(JsonWriter& w, const Fn<Sig>&) {
  w.raw("null");
}
template <class T>
void jsonWrite(JsonWriter& w, const Opt<T>& v) {
  if (v.has()) jsonWrite(w, v.get());
  else w.raw("null");
}
template <class... Ts>
void jsonWrite(JsonWriter& w, const std::variant<Ts...>& v) {
  std::visit([&](const auto& x) { jsonWrite(w, x); }, v);
}
template <class T>
void jsonWrite(JsonWriter& w, const Array<T>& a) {
  w.raw("[");
  for (size_t i = 0; i < a.size(); i++) {
    if (i) w.raw(",");
    T v = a.at(i);
    if (!jsonValue(w, v)) w.raw("null");
  }
  w.raw("]");
}
template <class... Ts>
void jsonWrite(JsonWriter& w, const std::tuple<Ts...>& t) {
  w.raw("[");
  size_t i = 0;
  std::apply(
      [&](const auto&... x) {
        ((w.raw(i++ ? "," : ""), jsonValue(w, x) ? void() : w.raw("null")), ...);
      },
      t);
  w.raw("]");
}
template <class V>
void jsonWrite(JsonWriter& w, const Dict<V>& d) {
  w.raw("{");
  bool first = true;
  Array<String> ks = d.keys();
  for (const auto& k : ks.items()) {
    V v = d.get(k).get();
    size_t mark = w.out.size();
    if (!first) w.raw(",");
    w.quote(k);
    w.raw(":");
    if (jsonValue(w, v)) first = false;
    else w.out.resize(mark);
  }
  w.raw("}");
}
template <class K, class V>
void jsonWrite(JsonWriter& w, const Map<K, V>&) {
  w.raw("{}");
}
template <class T>
void jsonWrite(JsonWriter& w, const Set<T>&) {
  w.raw("{}");
}
/// RegExp objects have no enumerable own properties; match results are arrays.
inline void jsonWrite(JsonWriter& w, const RegExp&) { w.raw("{}"); }
inline void jsonWrite(JsonWriter& w, const RegExpMatch& m) { jsonWrite(w, m->items); }

/// Date.prototype.toJSON: the ISO string, or null for an invalid date.
inline void jsonWrite(JsonWriter& w, const Date& d) {
  if (std::isnan(d->getTime())) w.raw("null");
  else w.quote(d->toISOString());
}
/// A Uint8Array, or the bytes a buffer's borrow lends: its indexes as keys.
template <class B>
void jsonWriteBytes(JsonWriter& w, const B& b) {
  w.raw("{");
  for (size_t i = 0; i < b.size(); i++) {
    if (i) w.raw(",");
    w.quote(numberToString(static_cast<double>(i)));
    w.raw(":");
    jsonWrite(w, b.at(i));
  }
  w.raw("}");
}
inline void jsonWrite(JsonWriter& w, const Bytes& b) { jsonWriteBytes(w, b); }
template <bool Writable>
class BasicByteSpan;
template <bool Writable>
void jsonWrite(JsonWriter& w, const BasicByteSpan<Writable>& b) {
  jsonWriteBytes(w, b);
}

/// toJSON's value: written as it is, its own toJSON not called again (its
/// members' are); false, writing nothing, when JSON omits it.
template <class T>
bool jsonResult(JsonWriter& w, const T& v) {
  if (jsonOmitted(v)) return false;
  jsonWrite(w, v);
  return true;
}
/// A value at a key or index, as SerializeJSONProperty writes it: toJSON's
/// value if it has one; false, writing nothing, when JSON omits it.
template <class T>
bool jsonValue(JsonWriter& w, const T& v) {
  return jsonResult(w, v);
}
template <class T>
bool jsonValue(JsonWriter& w, const Opt<T>& v) {
  if (v.isUndefined()) return false;
  if (!v.has()) {
    w.raw("null");
    return true;
  }
  return jsonValue(w, v.get());
}
template <class... Ts>
bool jsonValue(JsonWriter& w, const std::variant<Ts...>& v) {
  return std::visit([&](const auto& x) { return jsonValue(w, x); }, v);
}
template <JsonClass C>
bool jsonValue(JsonWriter& w, const Ref<C>& v) {
  if (!v) {
    w.raw("null");
    return true;
  }
  return v->lucentJson_(w, true);
}
/// A class instance's fields, toJSON aside (the value toJSON returned).
template <JsonClass C>
void jsonWrite(JsonWriter& w, const Ref<C>& v) {
  if (!v) w.raw("null");
  else v->lucentJson_(w, false);
}

/// Helper for generated writers: one `"name":value` member, none when JSON omits the value.
template <class T>
void jsonField(JsonWriter& w, bool& first, const char* name, const T& v) {
  size_t mark = w.out.size();
  if (!first) w.raw(",");
  w.quote(String::fromUtf8(name));
  w.raw(":");
  if (jsonValue(w, v)) first = false;
  else w.out.resize(mark);
}

namespace json {
template <class T>
Opt<String> stringifyOpt(const T& v) {
  JsonWriter w;
  if (!jsonValue(w, v)) return undefined;
  return String::fromUtf16(w.out);
}
template <class T>
String stringify(const T& v) {
  JsonWriter w;
  if (!jsonValue(w, v)) return String::fromLatin1("undefined");
  return String::fromUtf16(w.out);
}
}  // namespace json

}  // namespace lucent
