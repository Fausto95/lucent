// Lucent runtime — what the generated Fabric components share: reading the
// props React commits and the arguments of commands, comparing committed
// values, building event payloads, and naming a committed mount.
//
// Only the generated view sources (cpp/generated/views/) include it; it
// depends on React Native's renderer headers.
//
// Transport: every JavaScript value arrives as itself, except a nullable one
// (`T | null`), which the component's proxy boxes: `[value]`, `[null]` for
// null. React sends a removed prop as null, and turns undefined into null
// inside objects and argument lists, so without the box a missing value and
// null would look the same.
#pragma once

#include <folly/dynamic.h>
#include <jsi/jsi.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/core/RawValue.h>
#include <react/renderer/core/ReactPrimitives.h>

#include <lucent/report.h>

#include "LucentViewRequests.h"

#include <array>
#include <atomic>
#include <bitset>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace lucent::views {

using facebook::react::RawValue;

/** A value of another type than its prop, field or argument declares. */
struct Mismatch : std::invalid_argument {
  using std::invalid_argument::invalid_argument;
};

/** An object's fields, by name. */
using Fields = std::unordered_map<std::string, RawValue>;

// --- reading ---------------------------------------------------------------------------
//
// read(raw, out) for each type a component's values have: the ones here, and
// the ones each component generates for its objects and enums (found by
// argument-dependent lookup). All are declared before any is defined, so a
// template finds the others whatever order they nest in.

inline void read(const RawValue& raw, double& out);
inline void read(const RawValue& raw, bool& out);
inline void read(const RawValue& raw, std::string& out);
template <typename T>
void read(const RawValue& raw, std::vector<T>& out);
/** A nullable value: boxed. */
template <typename T>
void read(const RawValue& raw, std::optional<T>& out);

inline void read(const RawValue& raw, double& out) {
  if (!raw.hasType<double>()) throw Mismatch("expected a number");

  out = static_cast<double>(raw);
}

inline void read(const RawValue& raw, bool& out) {
  if (!raw.hasType<bool>()) throw Mismatch("expected a boolean");

  out = static_cast<bool>(raw);
}

inline void read(const RawValue& raw, std::string& out) {
  if (!raw.hasType<std::string>()) throw Mismatch("expected a string");

  out = static_cast<std::string>(raw);
}

/** A string that must be one of `values` (a string literal union). */
template <std::size_t N>
void readEnum(const RawValue& raw, std::string& out, const std::array<const char*, N>& values) {
  read(raw, out);

  for (const char* value : values)
    if (out == value) return;

  throw Mismatch("\"" + out + "\" is none of the declared strings");
}

inline std::vector<RawValue> items(const RawValue& raw) {
  if (!raw.hasType<std::vector<RawValue>>()) throw Mismatch("expected an array");

  return static_cast<std::vector<RawValue>>(raw);
}

template <typename T>
void read(const RawValue& raw, std::vector<T>& out) {
  auto all = items(raw);

  out.clear();
  out.reserve(all.size());

  for (std::size_t i = 0; i < all.size(); ++i) {
    T value{};

    try {
      read(all[i], value);
    } catch (const Mismatch& e) {
      throw Mismatch("[" + std::to_string(i) + "]: " + e.what());
    }

    out.push_back(std::move(value));
  }
}

template <typename T>
void read(const RawValue& raw, std::optional<T>& out) {
  auto box = items(raw);

  if (box.size() != 1) throw Mismatch("expected a nullable value's box");

  if (!box[0].hasValue()) {
    out = std::nullopt;
    return;
  }

  T value{};
  read(box[0], value);
  out = std::move(value);
}

inline Fields fields(const RawValue& raw) {
  if (!raw.hasType<Fields>()) throw Mismatch("expected an object");

  return static_cast<Fields>(raw);
}

/** A field the object must have. */
template <typename T>
void field(const Fields& from, const char* name, T& out) {
  auto it = from.find(name);

  if (it == from.end() || !it->second.hasValue())
    throw Mismatch(std::string("missing field ") + name);

  try {
    read(it->second, out);
  } catch (const Mismatch& e) {
    throw Mismatch(std::string(name) + ": " + e.what());
  }
}

/** A field the object may leave out: missing when it does, or when it is undefined. */
template <typename T>
void optionalField(const Fields& from, const char* name, std::optional<T>& out) {
  auto it = from.find(name);

  if (it == from.end() || !it->second.hasValue()) {
    out = std::nullopt;
    return;
  }

  T value{};

  try {
    read(it->second, value);
  } catch (const Mismatch& e) {
    throw Mismatch(std::string(name) + ": " + e.what());
  }

  out = std::move(value);
}

// --- props -----------------------------------------------------------------------------

/**
 * A prop in a commit, sent under `key`: the source's value when the commit
 * leaves it alone, missing when React removed it (or never set it), or the
 * value sent. A value of another type is reported and read as missing, as
 * React Native's own props fall back to their defaults.
 *
 * `key` must be a string literal: React Native keeps the pointer.
 */
template <typename T>
std::optional<T> prop(
    const facebook::react::RawProps& raw,
    const char* component,
    const char* name,
    const char* key,
    const std::optional<T>& source) {
  const RawValue* value = raw.at(key);

  if (value == nullptr) return source;
  if (!value->hasValue()) return std::nullopt;

  try {
    T out{};
    read(*value, out);
    return out;
  } catch (const Mismatch& e) {
    logError((std::string("[lucent] ") + component + " prop " + name + ": " + e.what()).c_str());
    return std::nullopt;
  }
}

/**
 * Which events JavaScript listens to, by slot, sent under `keys`: React
 * sends true for a function prop and null once it is removed.
 */
template <std::size_t N>
std::bitset<N> handlers(
    const facebook::react::RawProps& raw,
    const std::array<const char*, N>& keys,
    const std::bitset<N>& source) {
  auto out = source;

  for (std::size_t slot = 0; slot < N; ++slot)
    if (const RawValue* value = raw.at(keys[slot])) out[slot] = value->hasValue();

  return out;
}

// --- comparing -------------------------------------------------------------------------
//
// same(a, b): whether a committed value is unchanged. Numbers compare as
// Object.is does (NaN is itself; 0 and -0 differ); arrays and objects by
// their contents.

inline bool same(double a, double b) {
  return a == b ? std::signbit(a) == std::signbit(b) : std::isnan(a) && std::isnan(b);
}

inline bool same(bool a, bool b) { return a == b; }

inline bool same(const std::string& a, const std::string& b) { return a == b; }

template <typename T>
bool same(const std::vector<T>& a, const std::vector<T>& b);
template <typename T>
bool same(const std::optional<T>& a, const std::optional<T>& b);

template <typename T>
bool same(const std::vector<T>& a, const std::vector<T>& b) {
  if (a.size() != b.size()) return false;

  for (std::size_t i = 0; i < a.size(); ++i)
    if (!same(a[i], b[i])) return false;

  return true;
}

template <typename T>
bool same(const std::optional<T>& a, const std::optional<T>& b) {
  return a && b ? same(*a, *b) : !a && !b;
}

/**
 * same(a, b) for a value of any type, the ones a component generates
 * included: a qualified call (lucent::views::same) would not look them up.
 */
template <typename T>
bool sameValue(const T& a, const T& b) {
  return same(a, b);
}

// --- event payloads and results ---------------------------------------------------------
//
// toJs(runtime, value): the JavaScript value an event argument or a
// command's result is, exactly: nothing is boxed on the way to JavaScript.

namespace jsi = facebook::jsi;

inline jsi::Value toJs(jsi::Runtime&, double value) { return jsi::Value(value); }

inline jsi::Value toJs(jsi::Runtime&, bool value) { return jsi::Value(value); }

inline jsi::Value toJs(jsi::Runtime& runtime, const std::string& value) {
  return jsi::String::createFromUtf8(runtime, value);
}

template <typename T>
jsi::Value toJs(jsi::Runtime& runtime, const std::vector<T>& value);
/** A nullable value: null, or the value. */
template <typename T>
jsi::Value toJs(jsi::Runtime& runtime, const std::optional<T>& value);

template <typename T>
jsi::Value toJs(jsi::Runtime& runtime, const std::vector<T>& value) {
  jsi::Array out(runtime, value.size());

  for (std::size_t i = 0; i < value.size(); ++i) out.setValueAtIndex(runtime, i, toJs(runtime, value[i]));

  return out;
}

template <typename T>
jsi::Value toJs(jsi::Runtime& runtime, const std::optional<T>& value) {
  return value ? toJs(runtime, *value) : jsi::Value::null();
}

/**
 * toJs(runtime, value) for a value of any type, the ones a component
 * generates included: a qualified call (lucent::views::toJs) would not
 * look them up.
 */
template <typename T>
jsi::Value toJsValue(jsi::Runtime& runtime, const T& value) {
  return toJs(runtime, value);
}

/** Sets a property of an object being built. */
template <typename T>
void set(jsi::Runtime& runtime, jsi::Object& object, const char* name, const T& value) {
  object.setProperty(runtime, name, toJs(runtime, value));
}

/** Sets a property the value may leave out: an absent one stays absent. */
template <typename T>
void setOptional(jsi::Runtime& runtime, jsi::Object& object, const char* name, const std::optional<T>& value) {
  if (value) set(runtime, object, name, *value);
}

/**
 * An event's arguments, as the payload `{ args: [...] }`: by position,
 * because React Native adds the view's tag to every payload as `target`.
 * An optional argument the call left out is undefined, and the ones it
 * left out at the end are not there, so the callback gets as many
 * arguments as the call passed.
 */
class EventArguments {
 public:
  template <typename T>
  void add(jsi::Runtime& runtime, const T& value) {
    values_.push_back(toJs(runtime, value));
    passed_ = values_.size();
  }

  template <typename T>
  void addOptional(jsi::Runtime& runtime, const std::optional<T>& value) {
    if (value)
      add(runtime, *value);
    else
      values_.push_back(jsi::Value::undefined());
  }

  jsi::Value payload(jsi::Runtime& runtime) {
    jsi::Array args(runtime, passed_);

    for (std::size_t i = 0; i < passed_; ++i) args.setValueAtIndex(runtime, i, std::move(values_[i]));

    jsi::Object out(runtime);
    out.setProperty(runtime, "args", args);

    return out;
  }

 private:
  std::vector<jsi::Value> values_;
  std::size_t passed_ = 0;
};

// --- commands --------------------------------------------------------------------------

/** A command's arguments, as the host received them. */
inline std::vector<RawValue> arguments(const folly::dynamic& args) {
  if (!args.isArray()) throw Mismatch("expected a command's argument list");

  std::vector<RawValue> out;
  out.reserve(args.size());

  for (const auto& arg : args) out.emplace_back(arg);

  return out;
}

/** An argument the call must pass. */
template <typename T>
void argument(const std::vector<RawValue>& args, std::size_t index, const char* name, T& out) {
  if (index >= args.size() || !args[index].hasValue())
    throw Mismatch(std::string("missing argument ") + name);

  try {
    read(args[index], out);
  } catch (const Mismatch& e) {
    throw Mismatch(std::string(name) + ": " + e.what());
  }
}

/** An argument the call may leave out. */
template <typename T>
void optionalArgument(
    const std::vector<RawValue>& args,
    std::size_t index,
    const char* name,
    std::optional<T>& out) {
  if (index >= args.size() || !args[index].hasValue()) {
    out = std::nullopt;
    return;
  }

  T value{};

  try {
    read(args[index], value);
  } catch (const Mismatch& e) {
    throw Mismatch(std::string(name) + ": " + e.what());
  }

  out = std::move(value);
}

// --- mounts ----------------------------------------------------------------------------

/**
 * A committed mount: the host view's tag and the generation the host gave
 * it when the mount reached the UI. Every event, command and result checks
 * the whole token, so a recycled view's new occupant never receives its
 * predecessor's work.
 */
struct MountToken {
  facebook::react::Tag tag{0};
  std::uint64_t generation{0};

  bool operator==(const MountToken&) const = default;
};

/** A generation no mount had before, never 0 (0: not mounted). Any thread. */
inline std::uint64_t nextGeneration() {
  static std::atomic<std::uint64_t> last{0};

  return last.fetch_add(1, std::memory_order_relaxed) + 1;
}

}  // namespace lucent::views
