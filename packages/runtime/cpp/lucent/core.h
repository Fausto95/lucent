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

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <tuple>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>

namespace lucent {

template <class T>
using Ref = std::shared_ptr<T>;

/// A `nativeSize` (lucent:core's NativeSized) as a byte count: what is not
/// a positive number is 0, and a size past what memory holds is the most.
inline size_t nativeSizeOf(double bytes) {
  if (!(bytes > 0)) return 0;
  constexpr size_t most = std::numeric_limits<size_t>::max();
  if (bytes >= static_cast<double>(most)) return most;
  return static_cast<size_t>(bytes);
}

/// What indexBelow gives for a number that is not an index below its limit.
inline constexpr size_t kNoIndex = SIZE_MAX;

/// `v` as an index below `limit` (at most 2^53), when it is an integer there
/// (-0 is 0); otherwise kNoIndex.
inline size_t indexBelow(double v, size_t limit) {
  // A constant bound, then an integer comparison with `limit`: converting
  // the limit to a double costs a loop an instruction more each time.
  if (!(v >= 0 && v < 9007199254740992.0)) return kNoIndex;
  auto i = static_cast<size_t>(v);
#if defined(__x86_64__) && !defined(__SSE4_1__)
  // std::trunc is a call into the C library on x86-64 without SSE4.1 (the
  // baseline CI's Linux hosts build for): a double in range is an integer
  // exactly when converting it to an integer and back gives it again.
  bool integer = static_cast<double>(i) == v;
#else
  // One instruction elsewhere (frintz, roundsd), cheaper than the round trip.
  bool integer = std::trunc(v) == v;
#endif
  return integer && i < limit ? i : kNoIndex;
}

struct Object;

namespace detail {
/// A weak collection's entries (weak.h), which drops a key's when the key goes.
struct WeakTable {
  virtual ~WeakTable() = default;
  virtual void drop(const Object* key) noexcept = 0;
};
}  // namespace detail

namespace debug {
/// What an object's strong references are reported to (refs.h).
class RefSink;

namespace detail {
/// Whether objects are listed as they are made, for a debug build's cycle
/// report: a debug host turns it on (trackObjects, refs.h). Off, an object
/// pays one relaxed load when made and when it goes.
extern std::atomic<bool> tracking;
void track(const Object* o) noexcept;
void untrack(const Object* o) noexcept;
}  // namespace detail
}  // namespace debug

/// Base of every struct and class instance.
struct Object : std::enable_shared_from_this<Object> {
  Object() noexcept {
    if (debug::detail::tracking.load(std::memory_order_relaxed)) debug::detail::track(this);
  }
  /// A copy is another object: no weak collection's key.
  Object(const Object&) noexcept : std::enable_shared_from_this<Object>() {
    if (debug::detail::tracking.load(std::memory_order_relaxed)) debug::detail::track(this);
  }
  Object& operator=(const Object&) noexcept { return *this; }
  virtual ~Object() {
    if (weakTables_) dropWeakEntries();
    if (debug::detail::tracking.load(std::memory_order_relaxed)) debug::detail::untrack(this);
  }

  /// Reports the strong references it holds to other objects, each named by
  /// its field and source line, for a debug build's cycle report (refs.h).
  /// Generated classes and structs report their fields; the runtime's
  /// objects hold none worth naming.
  virtual void lucentRefs_(debug::RefSink&) const {}

  /// The bytes of native memory it holds, which JavaScript's collector
  /// counts toward its JavaScript object (lucent:core's NativeSized): a
  /// native buffer's size, or what a class's `nativeSize` says, read in its
  /// module. 0 for an object that holds none. Called on the JS thread.
  virtual size_t lucentNativeSize_() { return 0; }

  /// Records that `table` keeps an entry keyed by this object, for the
  /// object's destructor to drop.
  void keyIn(const std::shared_ptr<detail::WeakTable>& table);

 private:
  void dropWeakEntries() noexcept;

  /// The weak collections this object is a key of; null for nearly all objects.
  std::vector<std::weak_ptr<detail::WeakTable>>* weakTables_ = nullptr;
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
  /// A read of a collection of optionals (`xs[i]` of a `(T | undefined)[]`,
  /// `map.get(k)`, `record[k]`): absent when the element is, else the
  /// element as it is, null included. The types flatten `T | undefined |
  /// undefined` the same way (types.ts's unionOf). A template, taken only
  /// for that type: a constructor of `Opt<Opt<T>>` would make that type
  /// wherever Opt<T>'s constructors are weighed, as std::optional<Opt<T>>
  /// weighs them while it is incomplete.
  template <class R>
    requires std::is_same_v<std::remove_cvref_t<R>, Opt<Opt<T>>>
  explicit Opt(R&& read) {
    if (!read.has()) state_ = read.isNull() ? State::Null : State::Undefined;
    else if constexpr (std::is_lvalue_reference_v<R>) *this = read.get();
    else *this = std::move(read.get());
  }

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

/// One optional from an optional of one: a read of a collection of optionals
/// (emit/context.ts's elementOrUndefined).
template <class T>
Opt<T> flat(Opt<Opt<T>> read) {
  return Opt<T>(std::move(read));
}


/// An array of integer elements' `a[i]`: the number the element reads as, or undefined.
template <class T>
  requires std::is_integral_v<T>
Opt<double> numberOf(const Opt<T>& v) {
  return v.has() ? Opt<double>(static_cast<double>(v.get())) : Opt<double>(undefined);
}

template <class T>
struct IsOpt : std::false_type {};
template <class T>
struct IsOpt<Opt<T>> : std::true_type {};

/// A recursive alias's type (lucent_app::J_<alias>, which the compiler
/// generates for `type Json = … | Json[]`): an Opt or a variant by
/// inheritance, held again inside itself. Generic code takes it as that type
/// (aliasValue), where overloads for Opt and variant would see a class.
template <class T>
concept RecursiveAlias = requires { typename T::LucentAliasOf; };

template <class T>
const auto& aliasValue(const T& v) {
  if constexpr (RecursiveAlias<T>)
    return static_cast<const typename T::LucentAliasOf&>(v);
  else
    return v;
}

/// The same read of a recursive alias's collection (its elements are the
/// alias's J_ type): its value as the Opt or variant the alias is, absent
/// when the element is.
template <RecursiveAlias J>
auto flat(Opt<J> read) {
  using Base = typename J::LucentAliasOf;
  if constexpr (IsOpt<Base>::value) {
    using V = Opt<typename Base::ValueType>;
    if (!read.has()) return read.isNull() ? V(null) : V(undefined);
    return static_cast<V>(static_cast<Base&&>(std::move(read.get())));
  } else {
    using V = Opt<Base>;
    if (!read.has()) return read.isNull() ? V(null) : V(undefined);
    return V(static_cast<Base&&>(std::move(read.get())));
  }
}

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

/// `WeakRef<T>`: a reference to `R`'s object (a class instance, an
/// interface or object value) that does not keep it alive. Reference
/// counting frees an object with its last strong reference, so deref()
/// gives undefined from then on: a cycle through a WeakRef frees.
template <class R>
struct WeakRefObject : Object {
  explicit WeakRefObject(const R& target) : target_(target) {}

  Opt<R> deref() const {
    if (auto strong = target_.lock()) return Opt<R>(std::move(strong));
    return Opt<R>(undefined);
  }

 private:
  std::weak_ptr<typename R::element_type> target_;
};

/// lucent:core's JSValue: a value JavaScript gave, which Lucent code holds
/// without looking inside, and gives back as the same value. The JSI layer
/// makes one (a host's reference, released on the JS thread with the last
/// Lucent one); nothing else reads it, so comparing or converting one is a
/// TypeError where the compiler cannot refuse it.
struct JSValueObject : Object {};
using JSValue = Ref<JSValueObject>;

[[noreturn]] void throwOpaque(const char* what);

/// `ReferenceError: Cannot access 'name' before initialization`.
[[noreturn]] void throwBeforeInitialization(const char* name);

/// Box's constructor for a variable in its temporal dead zone.
struct TdzTag {};
inline constexpr TdzTag tdz{};

/// Boxes a local that a closure captures and later mutates, so the closure and
/// the enclosing function share one variable, as in JavaScript. A `let` or
/// `const` that a closure made before its declaration holds is boxed in its
/// temporal dead zone: using it before init() throws ReferenceError.
template <class T>
class Box {
 public:
  Box() : p_(std::make_shared<Cell>()) {}
  explicit Box(T v) : p_(std::make_shared<Cell>(std::move(v))) {}
  Box(TdzTag, const char* name) : p_(std::make_shared<Cell>()) { p_->pending = name; }
  T& operator*() const {
    if (p_->pending) [[unlikely]]
      throwBeforeInitialization(p_->pending);
    return p_->value;
  }
  T* operator->() const { return &**this; }
  /// The declaration runs: the variable holds `v`, and may be used.
  void init(T v) const {
    p_->value = std::move(v);
    p_->pending = nullptr;
  }

 private:
  struct Cell {
    T value{};
    /// Its name while in its temporal dead zone.
    const char* pending = nullptr;
    Cell() = default;
    explicit Cell(T v) : value(std::move(v)) {}
  };
  std::shared_ptr<Cell> p_;
};

/// A use of a module variable code may reach before its declaration runs:
/// ReferenceError until `init()` has run it (`initialize`).
template <class T>
T& declared(bool done, const char* name, T& variable) {
  if (!done) [[unlikely]] throwBeforeInitialization(name);
  return variable;
}
/// Such a variable's declaration: its value, and the end of its dead zone.
template <class T, class V>
void initialize(bool& done, T& variable, V&& value) {
  variable = std::forward<V>(value);
  done = true;
}

}  // namespace lucent
