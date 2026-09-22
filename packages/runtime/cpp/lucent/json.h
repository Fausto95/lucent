// Lucent runtime — JSON.stringify for Lucent values. Generated code adds
// `jsonWrite` overloads for each struct and class (found by ADL).
#pragma once

#include <cmath>
#include <string>
#include <tuple>
#include <variant>

#include "array.h"
#include "bytes.h"
#include "core.h"
#include "error.h"
#include "function.h"
#include "map.h"
#include "number.h"
#include "string.h"

namespace lucent {

struct JsonWriter {
  std::u16string out;
  void raw(const char* s) {
    while (*s) out.push_back(static_cast<unsigned char>(*s++));
  }
  void quote(const String& s);
};

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
inline void jsonWrite(JsonWriter& w, const String& s) { w.quote(s); }
inline void jsonWrite(JsonWriter& w, Undefined) { w.raw("null"); }
inline void jsonWrite(JsonWriter& w, Null) { w.raw("null"); }
inline void jsonWrite(JsonWriter& w, const Error&) { w.raw("{}"); }
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
    if (jsonOmitted(v)) w.raw("null");
    else jsonWrite(w, v);
  }
  w.raw("]");
}
template <class... Ts>
void jsonWrite(JsonWriter& w, const std::tuple<Ts...>& t) {
  w.raw("[");
  size_t i = 0;
  std::apply(
      [&](const auto&... x) {
        ((w.raw(i++ ? "," : ""), jsonOmitted(x) ? w.raw("null") : jsonWrite(w, x)), ...);
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
    if (jsonOmitted(v)) continue;
    if (!first) w.raw(",");
    first = false;
    w.quote(k);
    w.raw(":");
    jsonWrite(w, v);
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
inline void jsonWrite(JsonWriter& w, const Bytes& b) {
  w.raw("{");
  for (size_t i = 0; i < b.size(); i++) {
    if (i) w.raw(",");
    w.quote(numberToString(static_cast<double>(i)));
    w.raw(":");
    jsonWrite(w, b.at(i));
  }
  w.raw("}");
}
/// Helper for generated struct writers: one `"name":value` member.
template <class T>
void jsonField(JsonWriter& w, bool& first, const char* name, const T& v) {
  if (jsonOmitted(v)) return;
  if (!first) w.raw(",");
  first = false;
  w.quote(String::fromUtf8(name));
  w.raw(":");
  jsonWrite(w, v);
}

namespace json {
template <class T>
Opt<String> stringifyOpt(const T& v) {
  if (jsonOmitted(v)) return undefined;
  JsonWriter w;
  jsonWrite(w, v);
  return String::fromUtf16(w.out);
}
template <class T>
String stringify(const T& v) {
  JsonWriter w;
  if (jsonOmitted(v)) return String::fromLatin1("undefined");
  jsonWrite(w, v);
  return String::fromUtf16(w.out);
}
}  // namespace json

}  // namespace lucent
