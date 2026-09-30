// Lucent runtime — native extensions: C functions a Lucent package declares.
//
// A Handle owns an opaque C pointer an extension's create function gave.
// It closes at the first of close() or its last copy going; the destroy
// function runs once, on the context the handle requires. After that,
// every use throws InvalidStateError.
//
// The conversions check what crosses into C: numbers into integer
// parameters as WebIDL's [EnforceRange] does, bigints exactly, byte counts
// against their length type, and strings as NUL-terminated UTF-8.
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <type_traits>

#include "bigint.h"
#include "bytes.h"
#include "execution.h"
#include "jserror.h"
#include "jsstring.h"
#include "number.h"
#include "resource.h"

namespace lucent {

class Handle {
  struct State;

 public:
  /// The pointer, held for one call: a close meanwhile (from another
  /// thread) destroys it when the call is done, never under it.
  template <class T>
  class Use {
   public:
    explicit Use(std::shared_ptr<State> state) : state_(std::move(state)) {}
    Use(const Use&) = delete;
    Use& operator=(const Use&) = delete;
    ~Use() { state_->release(); }

    T* get() const { return static_cast<T*>(state_->pointer); }

   private:
    std::shared_ptr<State> state_;
  };

  /// Empty: every use throws until a handle is assigned.
  Handle() = default;

  /// Owns `pointer` (never null); `destroy` takes it once, on `destroyOn`'s
  /// thread when given. `what` names it in errors ("OrbitFilter is closed").
  static Handle open(const char* what, void* pointer, void (*destroy)(void*), ExecutionContext* destroyOn = nullptr);

  /// The pointer, for a call: throws InvalidStateError unless open.
  template <class T>
  Use<T> use() const {
    acquire();
    return Use<T>(state_);
  }

  /// The pointer, unheld (tests): throws InvalidStateError unless open.
  template <class T>
  T* get() const {
    return use<T>().get();
  }

  /// Destroys the pointer now (or posts it to its context), or when the
  /// calls using it are done. Idempotent.
  void close() const;

  /// The same handle: copies share one.
  const void* identity() const { return state_.get(); }

 private:
  struct State {
    void* pointer = nullptr;
    void (*destroy)(void*) = nullptr;

    std::mutex mutex;
    int calls = 0;
    bool deferred = false;

    /// Last: destroyed first, so a backstop close still finds the fields above.
    std::shared_ptr<Resource> resource;

    /// The resource's release: destroys now, or leaves it to the last call.
    void closing();
    /// A call is done.
    void release();
  };

  void acquire() const;

  std::shared_ptr<State> state_;
};

inline bool strictEquals(const Handle& a, const Handle& b) { return a.identity() == b.identity(); }
inline String toJsString(const Handle&) { return String::fromLatin1("[object Handle]"); }

namespace ext {

[[noreturn]] void outOfRange(const char* what, const std::string& low, const std::string& high, const std::string& value);

/// A number as C integer type `I`: truncated toward zero; RangeError when
/// it is not finite or outside `I`. `what` names the parameter.
template <class I>
  requires std::is_integral_v<I>
I integer(double v, const char* what) {
  using L = std::numeric_limits<I>;
  double t = std::trunc(v);

  if (!(t >= static_cast<double>(L::min()) && t <= static_cast<double>(L::max())) ||
      (sizeof(I) == 8 && t == static_cast<double>(L::max())))
    outOfRange(what, std::to_string(L::min()), std::to_string(L::max()), numberToString(v).toUtf8());

  return static_cast<I>(t);
}

/// A bigint as C integer type `I`, exactly; RangeError outside `I`.
template <class I>
  requires std::is_integral_v<I>
I integer(const BigInt& v, const char* what) {
  using L = std::numeric_limits<I>;

  if constexpr (std::is_signed_v<I>) {
    auto x = v.tryInt64();
    if (x && *x >= static_cast<int64_t>(L::min()) && *x <= static_cast<int64_t>(L::max())) return static_cast<I>(*x);
  } else {
    auto x = v.tryUint64();
    if (x && *x <= static_cast<uint64_t>(L::max())) return static_cast<I>(*x);
  }

  outOfRange(what, std::to_string(L::min()), std::to_string(L::max()), v.toString().toUtf8());
}

/// A number as C floating type `F`, rounded as Math.fround does: infinite
/// from halfway past float's largest value on (rather than undefined
/// behavior), the largest below that.
template <class F>
  requires std::is_floating_point_v<F>
F real(double v) {
  using L = std::numeric_limits<F>;

  if constexpr (sizeof(F) < sizeof(double)) {
    // The largest plus half its gap to infinity: a tie, which rounds to even (infinity).
    const double overflow = static_cast<double>(L::max()) + std::ldexp(1.0, L::max_exponent - L::digits - 1);

    if (v >= overflow) return L::infinity();
    if (v <= -overflow) return -L::infinity();
  }

  return static_cast<F>(v);
}

/// The bytes' data for a C pointer: never null, even for none.
uint8_t* data(Bytes& bytes);

/// A byte count as the C length type `I`; RangeError when it does not fit.
template <class I>
  requires std::is_integral_v<I>
I length(size_t n, const char* what) {
  if (n > static_cast<std::make_unsigned_t<I>>(std::numeric_limits<I>::max()))
    throwError(String::fromLatin1("RangeError"),
               String::fromUtf8(std::string(what) + " is " + std::to_string(n) + " bytes; at most " +
                                std::to_string(std::numeric_limits<I>::max()) + " fit"));

  return static_cast<I>(n);
}

/// A C integer result as a number (types of 32 bits or fewer: always exact).
template <class I>
  requires std::is_integral_v<I>
double number(I v) {
  static_assert(sizeof(I) <= 4, "64-bit C integers cross as bigints");
  return static_cast<double>(v);
}

/// A C integer result as a bigint.
template <class I>
  requires std::is_integral_v<I>
BigInt bigint(I v) {
  if constexpr (std::is_signed_v<I>)
    return BigInt::fromInt64(static_cast<int64_t>(v));
  else
    return BigInt::fromUint64(static_cast<uint64_t>(v));
}

/// Runs a call into C. An exception escaping it (a C++ implementation that
/// did not catch) ends the process here instead of unwinding through Lucent
/// and JSI frames that expect none.
template <class F>
decltype(auto) call(F&& f) noexcept {
  return f();
}

/// A string argument: NUL-terminated UTF-8 (TypeError if it holds NUL).
std::string utf8(const String& s, const char* what);

/// Throws the Error a failed call reports: C's message (copied now; the
/// function's name when it has none) and its code.
[[noreturn]] void fail(const char* function, const char* message);
[[noreturn]] void fail(const char* function, const char* message, long long code);

}  // namespace ext
}  // namespace lucent
