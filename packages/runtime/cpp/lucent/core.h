// Lucent runtime — core value model.
//
// Every Lucent value is one of:
//   * a primitive held by value: double (number), bool (boolean), String
//     (an immutable, shared UTF-16 string);
//   * a handle to a shared heap object (Array, Map, Set, Dict, Bytes, Fn,
//     Promise, and Ref<T> for structs and classes). Copying a handle aliases
//     the object, exactly like assigning an object in JavaScript;
//   * Opt<T> for `T | undefined | null`, and Union<...> for other unions.
//
// Objects are reference counted. There is no cycle collector: a cycle of
// strong references is kept alive until the process ends.
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <tuple>
#include <type_traits>
#include <utility>
#include <variant>

namespace lucent {

template <class T>
using Ref = std::shared_ptr<T>;

/// Base of every struct and class instance.
struct Object : std::enable_shared_from_this<Object> {
  virtual ~Object() = default;
};

struct Undefined {
  friend constexpr bool operator==(Undefined, Undefined) { return true; }
};
struct Null {
  friend constexpr bool operator==(Null, Null) { return true; }
};
inline constexpr Undefined undefined{};
inline constexpr Null null{};

[[noreturn]] void throwTypeError(const char* message);
[[noreturn]] void throwRangeError(const char* message);

/// Placed where TypeScript proved control cannot reach (e.g. after an
/// exhaustive switch). Throws instead of running off the end of a function.
[[noreturn]] inline void unreachable() { throwTypeError("Reached code the type checker proved unreachable"); }

/// `T | undefined | null`. Remembers which of the two absent values it holds
/// so `x === null` and `x === undefined` behave as in JavaScript.
/// null and undefined: the values an Opt holds as its states, never as its value.
template <class T>
inline constexpr bool IsAbsent = std::is_same_v<T, Undefined> || std::is_same_v<T, Null>;

template <class T>
class Opt {
 public:
  using ValueType = T;
  enum class State : uint8_t { Undefined, Null, Value };

  Opt() = default;
  Opt(Undefined) {}
  Opt(Null) : state_(State::Null) {}
  // `null | undefined` is an Opt<Undefined>: absent either way, never a value.
  Opt(const T& v)
    requires(!IsAbsent<T>)
      : value_(v), state_(State::Value) {}
  Opt(T&& v)
    requires(!IsAbsent<T>)
      : value_(std::move(v)), state_(State::Value) {}
  template <class U,
            std::enable_if_t<!std::is_same_v<std::decay_t<U>, Opt> &&
                                 !std::is_same_v<std::decay_t<U>, T> &&
                                 !std::is_same_v<std::decay_t<U>, Undefined> &&
                                 !std::is_same_v<std::decay_t<U>, Null> &&
                                 std::is_constructible_v<T, U&&>,
                             int> = 0>
  Opt(U&& v) : value_(T(std::forward<U>(v))), state_(State::Value) {}

  bool has() const { return state_ == State::Value; }
  bool isUndefined() const { return state_ == State::Undefined; }
  bool isNull() const { return state_ == State::Null; }
  State state() const { return state_; }

  /// The `!` operator: a checked unwrap.
  const T& value() const {
    if (state_ != State::Value) throwTypeError(state_ == State::Null ? "Unexpected null value" : "Unexpected undefined value");
    return *value_;
  }
  T& value() {
    if (state_ != State::Value) throwTypeError(state_ == State::Null ? "Unexpected null value" : "Unexpected undefined value");
    return *value_;
  }
  /// Unchecked access after a narrowing check the compiler has proven.
  const T& get() const { return *value_; }
  T& get() { return *value_; }

  template <class U>
  T valueOr(U&& fallback) const {
    return has() ? *value_ : T(std::forward<U>(fallback));
  }

 private:
  std::optional<T> value_;
  State state_ = State::Undefined;
};

template <class T>
struct IsOpt : std::false_type {};
template <class T>
struct IsOpt<Opt<T>> : std::true_type {};

template <class T>
struct IsRef : std::false_type {};
template <class T>
struct IsRef<std::shared_ptr<T>> : std::true_type {};

template <class... Ts>
using Union = std::variant<Ts...>;

template <class T>
struct IsVariant : std::false_type {};
template <class... Ts>
struct IsVariant<std::variant<Ts...>> : std::true_type {};

template <class T>
struct IsTuple : std::false_type {};
template <class... Ts>
struct IsTuple<std::tuple<Ts...>> : std::true_type {};

/// Whether storage of an object type (a Ref, or a union or tuple holding
/// one) was never written: it holds a null Ref where JavaScript has undefined.
template <class T>
bool unassigned(const T& v) {
  if constexpr (IsRef<T>::value) {
    return v == nullptr;
  } else if constexpr (IsVariant<T>::value) {
    return std::visit([](const auto& x) { return unassigned(x); }, v);
  } else if constexpr (IsTuple<T>::value) {
    return std::apply([](const auto&... xs) { return (unassigned(xs) || ...); }, v);
  } else {
    return false;
  }
}

[[noreturn]] void throwUnassigned(const char* what);

/// A read of storage that may be unassigned (a field read from a base
/// constructor, a variable before its initializer): JavaScript's undefined
/// would throw a TypeError where it is used as an object, so it throws here.
template <class T>
const T& assigned(const T& v, const char* what) {
  if (unassigned(v)) throwUnassigned(what);
  return v;
}

/// Boxes a local that a closure captures and later mutates, so the closure and
/// the enclosing function share one variable, as in JavaScript.
template <class T>
class Box {
 public:
  Box() : p_(std::make_shared<T>()) {}
  explicit Box(T v) : p_(std::make_shared<T>(std::move(v))) {}
  T& operator*() const { return *p_; }
  T* operator->() const { return p_.get(); }

 private:
  std::shared_ptr<T> p_;
};

}  // namespace lucent
