// Lucent runtime — JSON.parse into typed values.
//
// The text is parsed into a JsonValue tree (SyntaxError on invalid JSON),
// then JsonRead<T> builds the typed value, throwing a TypeError that names
// the path when the shape does not match the type. The compiler generates
// JsonRead specializations for object types and unions.
#pragma once

#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "array.h"
#include "core.h"
#include "jsstring.h"
#include "map.h"

namespace lucent {

struct JsonMember;

struct JsonValue {
  enum class Kind : uint8_t { Null, Bool, Number, String, Array, Object };
  Kind kind = Kind::Null;
  bool boolean = false;
  double number = 0;
  String string;
  std::vector<JsonValue> items;
  // A named struct, not std::pair: pair needs JsonValue complete here.
  std::vector<JsonMember> members;

  /// The member named `key`; the last one wins when a key repeats.
  const JsonValue* find(const String& key) const;
  /// "a number", "an object", … for error messages.
  const char* describe() const;
};

struct JsonMember {
  String key;
  JsonValue value;
};

/// Parses JSON text; throws SyntaxError.
JsonValue jsonParseTree(const String& text);

/// TypeError: `JSON.parse: expected <expected> at <path>, got <what>`.
[[noreturn]] void jsonShapeError(const std::string& path, const char* expected, const char* got);

template <class T>
struct JsonRead;

template <>
struct JsonRead<double> {
  static double read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::Number) jsonShapeError(p, "a number", v.describe());
    return v.number;
  }
};
template <>
struct JsonRead<bool> {
  static bool read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::Bool) jsonShapeError(p, "a boolean", v.describe());
    return v.boolean;
  }
};
template <>
struct JsonRead<String> {
  static String read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::String) jsonShapeError(p, "a string", v.describe());
    return v.string;
  }
};
template <>
struct JsonRead<Null> {
  static Null read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::Null) jsonShapeError(p, "null", v.describe());
    return null;
  }
};
template <class T>
struct JsonRead<Opt<T>> {
  static Opt<T> read(const JsonValue& v, const std::string& p) {
    if (v.kind == JsonValue::Kind::Null) return Opt<T>(null);
    return Opt<T>(JsonRead<T>::read(v, p));
  }
};
template <class T>
struct JsonRead<Array<T>> {
  static Array<T> read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::Array) jsonShapeError(p, "an array", v.describe());
    Array<T> out;
    for (size_t i = 0; i < v.items.size(); i++) out.push(JsonRead<T>::read(v.items[i], p + "[" + std::to_string(i) + "]"));
    return out;
  }
};
template <class V>
struct JsonRead<Dict<V>> {
  static Dict<V> read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::Object) jsonShapeError(p, "an object", v.describe());
    Dict<V> out;
    for (const auto& [k, m] : v.members) out.set(k, JsonRead<V>::read(m, p + "." + k.toUtf8()));
    return out;
  }
};
template <class... Ts>
struct JsonRead<std::tuple<Ts...>> {
  static std::tuple<Ts...> read(const JsonValue& v, const std::string& p) {
    if (v.kind != JsonValue::Kind::Array || v.items.size() < sizeof...(Ts)) jsonShapeError(p, "a longer array", v.describe());
    return build(v, p, std::index_sequence_for<Ts...>{});
  }
  template <size_t... I>
  static std::tuple<Ts...> build(const JsonValue& v, const std::string& p, std::index_sequence<I...>) {
    return std::tuple<Ts...>{JsonRead<Ts>::read(v.items[I], p + "[" + std::to_string(I) + "]")...};
  }
};

/// One member of an object type (used by generated readers). A missing
/// member is undefined for optional types and an error otherwise.
template <class T>
T jsonMember(const JsonValue& obj, const char* key, const std::string& path) {
  const JsonValue* m = obj.find(String::fromUtf8(key));
  std::string at = path + "." + key;
  if (!m) {
    if constexpr (IsOpt<T>::value) return T(undefined);
    else jsonShapeError(at, "a value", "undefined");
  }
  return JsonRead<T>::read(*m, at);
}

/// `JSON.parse(text) as T`.
template <class T>
T jsonParse(const String& text) {
  JsonValue v = jsonParseTree(text);
  return JsonRead<T>::read(v, "");
}

}  // namespace lucent
