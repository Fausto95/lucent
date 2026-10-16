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
//
// A C++ header's classes (decision 0125) are handles too, of the objects
// their constructors make, which the handle deletes. Their calls go
// through cxxCall, which makes what C++ throws an Error; strings, vectors
// and optionals cross as C++'s own.
//
// A callback (decisions 0126 and 0128) is a Lucent function a call hands C
// or C++. It belongs to the context the call ran on. Called on a thread
// running that context's code, it runs at once; from any other, it is
// posted there, or refused when C wants its result. What it throws at once
// is thrown by the extension call running on that thread (a CallFrame).
// C reaches it through the `void *` it passes back, a token of the
// callbacks' registry until the callback ends; C++ through a
// std::function, each copy of which keeps it.
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#include "abort.h"
#include "array.h"
#include "bigint.h"
#include "bytes.h"
#include "execution.h"
#include "function.h"
#include "jserror.h"
#include "jsstring.h"
#include "number.h"
#include "report.h"
#include "resource.h"
#include "scope.h"

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

  /// Runs `f` once the destroy function has returned: then, or now if it
  /// has. What lives as long as the handle (a callback C keeps) ends there.
  void whenDestroyed(std::function<void()> f) const;

  /// The same handle: copies share one.
  const void* identity() const { return state_.get(); }

 private:
  struct State {
    void* pointer = nullptr;
    void (*destroy)(void*) = nullptr;

    std::mutex mutex;
    int calls = 0;
    bool deferred = false;
    bool destroyed = false;
    /// Run once the destroy function has returned.
    std::vector<std::function<void()>> afterDestroy;

    /// Last: destroyed first, so a backstop close still finds the fields above.
    std::shared_ptr<Resource> resource;

    /// The resource's release: destroys now, or leaves it to the last call.
    void closing();
    /// A call is done.
    void release();
    /// Destroys the pointer, then runs what waited for that.
    void destroyNow();
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

namespace detail {

/// The extension calls running on a thread, innermost first: what a
/// callback that ran at once during one threw, which the call throws once
/// it returns (decision 0128).
class CallFrame {
 public:
  CallFrame() : outer_(innermost()) { innermost() = this; }
  ~CallFrame() { innermost() = outer_; }
  CallFrame(const CallFrame&) = delete;
  CallFrame& operator=(const CallFrame&) = delete;

  /// The innermost call running on this thread; null outside any.
  static CallFrame*& innermost();

  /// Keeps what a callback threw: the first, if several did.
  void threw(std::exception_ptr e) {
    if (!error_) error_ = std::move(e);
  }

  /// Throws what a callback threw during the call, if one did.
  void rethrow() {
    if (error_) std::rethrow_exception(std::exchange(error_, nullptr));
  }

  /// What a callback threw during the call (null if none), no longer kept.
  std::exception_ptr take() { return std::exchange(error_, nullptr); }

 private:
  CallFrame* const outer_;
  std::exception_ptr error_;
};

/// A callback that ran at once threw: the call running on this thread
/// throws it once it returns, or, outside any, it is reported.
void thrownAtOnce(std::exception_ptr e);

template <class F>
decltype(auto) callC(F& f) noexcept {
  return f();
}

}  // namespace detail

/// Runs a call into C. An exception escaping it (a C++ implementation that
/// did not catch) ends the process here instead of unwinding through Lucent
/// and JSI frames that expect none. What a callback it called threw is
/// thrown once it returns.
template <class F>
decltype(auto) call(F&& f) {
  detail::CallFrame frame;

  if constexpr (std::is_void_v<decltype(f())>) {
    detail::callC(f);
    frame.rethrow();
  } else {
    decltype(auto) r = detail::callC(f);
    frame.rethrow();
    return r;
  }
}

/// As call(), but what a callback threw is left in `thrown`: the caller
/// throws it (rethrow) once it has released what the call filled in.
template <class F>
decltype(auto) call(std::exception_ptr& thrown, F&& f) {
  detail::CallFrame frame;

  if constexpr (std::is_void_v<decltype(f())>) {
    detail::callC(f);
    thrown = frame.take();
  } else {
    decltype(auto) r = detail::callC(f);
    thrown = frame.take();
    return r;
  }
}

/// Throws `thrown`, if it holds an error.
inline void rethrow(std::exception_ptr& thrown) {
  if (thrown) std::rethrow_exception(std::exchange(thrown, nullptr));
}

/// A string argument: NUL-terminated UTF-8 (TypeError if it holds NUL).
std::string utf8(const String& s, const char* what);

/// Throws the Error a failed call reports: C's message (copied now; the
/// function's name when it has none) and its code.
[[noreturn]] void fail(const char* function, const char* message);
[[noreturn]] void fail(const char* function, const char* message, long long code);

// --- C++ classes (decision 0125) -------------------------------------------------------

/// A string for C++: its UTF-8, NUL characters and all.
std::string cxxString(const String& s);

/// A C++ string, UTF-8, as Lucent's.
String fromCxx(std::string_view s);

/// Throws the Error a C++ call threw: `message` (an exception's what()),
/// or, for one that is no std::exception, one saying `what` threw.
[[noreturn]] void cxxThrew(const char* what, const char* message);

namespace detail {
template <class F>
decltype(auto) cxxTry(const char* what, F& f) {
  try {
    return f();
  } catch (const std::exception& e) {
    cxxThrew(what, e.what());
  } catch (...) {
    cxxThrew(what, nullptr);
  }
}
}  // namespace detail

/// Runs a call into C++, `what` (`Counter.add`): what it throws becomes an
/// Error here, so no C++ exception unwinds through Lucent's frames. What a
/// callback it called threw is thrown once it returns.
template <class F>
decltype(auto) cxxCall(const char* what, F&& f) {
  detail::CallFrame frame;

  if constexpr (std::is_void_v<decltype(f())>) {
    detail::cxxTry(what, f);
    frame.rethrow();
  } else {
    decltype(auto) r = detail::cxxTry(what, f);
    frame.rethrow();
    return r;
  }
}

/// An array as a std::vector of C++'s `C`, `each` converting an element.
template <class C, class T, class F>
std::vector<C> cxxVector(const Array<T>& a, F each) {
  std::vector<C> out;
  out.reserve(a.size());
  for (size_t i = 0; i < a.size(); i++) out.push_back(each(a.at(i)));
  return out;
}

/// An optional value as a std::optional of C++'s `C`: none for undefined.
template <class C, class T, class F>
std::optional<C> cxxOptional(const Opt<T>& o, F each) {
  if (!o.has()) return std::nullopt;
  return std::optional<C>(each(o.get()));
}

/// A std::vector as an array, `each` converting an element.
template <class T, class F>
auto fromCxxVector(const std::vector<T>& v, F each) {
  using U = std::decay_t<decltype(each(std::declval<const T&>()))>;
  Array<U> out;
  for (const auto& x : v) out.push(each(x));
  return out;
}

/// A std::optional as an optional value: undefined for none.
template <class T, class F>
auto fromCxxOptional(const std::optional<T>& o, F each) {
  using U = std::decay_t<decltype(each(std::declval<const T&>()))>;
  return o ? Opt<U>(each(*o)) : Opt<U>(undefined);
}

/// Deletes an object of `T` a handle owns: its destroy function.
template <class T>
void deleteObject(void* p) {
  delete static_cast<T*>(p);
}

// --- signals (decision 0129) ---------------------------------------------------------

/// A call's AbortSignal, as C polls it: its `requested` flag, or one that
/// stays false for none.
class SignalFlag {
 public:
  /// Throws the reason of a signal already aborted: no call is made.
  explicit SignalFlag(const Opt<AbortSignal>& signal);
  SignalFlag(const SignalFlag&) = delete;
  SignalFlag& operator=(const SignalFlag&) = delete;

  /// For a `const volatile bool *` parameter: lock-free, a std::atomic<bool> is a bool.
  const volatile bool* c() const { return reinterpret_cast<const volatile bool*>(&flag()); }

  /// For a `const std::atomic<bool> &` parameter.
  const std::atomic<bool>& cxx() const { return flag(); }

  /// After the call: throws the signal's reason if it aborted during it.
  void done() const;

 private:
  const std::atomic<bool>& flag() const;

  AbortSignal signal_;
};

static_assert(std::atomic<bool>::is_always_lock_free && sizeof(std::atomic<bool>) == sizeof(bool),
              "C reads a signal's flag as a bool");

/// As cxxCall(), with a signal whose reason, if it aborted during the
/// call, is thrown instead of whatever the call threw or returned.
template <class F>
decltype(auto) cxxCall(const char* what, const SignalFlag& signal, F&& f) {
  try {
    if constexpr (std::is_void_v<decltype(f())>) {
      cxxCall(what, f);
      signal.done();
    } else {
      decltype(auto) r = cxxCall(what, f);
      signal.done();
      return r;
    }
  } catch (...) {
    signal.done();
    throw;
  }
}

// --- callbacks (decisions 0126 and 0128) -----------------------------------------------

/// How long C may call a callback: until the call returns, until its first
/// call, until a handle's destroy function returned, or, in C++, while a
/// copy of its std::function is kept. Every one also ends with its module
/// state.
enum class Lives : uint8_t { Call, Once, Handle, Copies };

/// A callback, shared by the call that hands it over and every call of it:
/// the context it runs on, and a refusal to throw once the call returns.
class CallbackState {
 public:
  /// Belongs to the calling context. `what` (a literal) names it in errors:
  /// "tally_each's each".
  CallbackState(const char* what, Lives lives);
  virtual ~CallbackState() = default;
  CallbackState(const CallbackState&) = delete;
  CallbackState& operator=(const CallbackState&) = delete;

  const char* what() const { return what_; }
  Lives lives() const { return lives_; }

  /// Whether a call made now runs at once: this thread runs its context's code.
  bool runsHere() const { return context().isCurrent(); }

  /// Runs `job` as a turn of its context, after those posted before it;
  /// dropped once its module state ended.
  void post(Job job);

  /// What its module state ends with.
  const std::shared_ptr<Scope>& scope() const { return scope_; }

  /// A call refused (one wanting a result, from another thread): the call
  /// throws it once it returns, if it still runs; otherwise it is reported.
  void refuse();

  /// The call it was handed to returned.
  void returned();

  /// After the call: throws a refusal made during it.
  void rethrow();

 protected:
  ExecutionContext& context() const { return ExecutionContext::of(owner_); }

 private:
  [[noreturn]] void throwRefusal() const;

  const char* const what_;
  const Lives lives_;
  const ContextRef owner_;
  const std::shared_ptr<Scope> scope_;

  std::mutex mutex_;
  bool during_ = true;
  bool refused_ = false;
};

/// What a callback keeps of an argument C or C++ passes: a string's copy
/// (a null `const char *` is empty), any other value itself.
template <class C>
auto kept(C&& v) {
  using D = std::decay_t<C>;

  if constexpr (std::is_same_v<D, const char*> || std::is_same_v<D, char*>)
    return v ? std::string(v) : std::string();
  else if constexpr (std::is_same_v<D, std::string_view> || std::is_same_v<D, std::string>)
    return std::string(v);
  else
    return static_cast<D>(v);
}

/// A kept argument as the Lucent function's parameter type `L`.
template <class L, class K>
L toLucent(const K& v) {
  if constexpr (std::is_same_v<L, String>)
    return String::fromUtf8(std::string_view(v));
  else if constexpr (std::is_same_v<L, BigInt>)
    return bigint(v);
  else if constexpr (std::is_same_v<L, bool>)
    return static_cast<bool>(v);
  else
    return static_cast<double>(v);
}

/// What the Lucent function returned as C's result type `C`: checked as an
/// argument is, `what` naming it.
template <class C, class L>
C toC(const L& v, const char* what) {
  if constexpr (std::is_same_v<C, bool> || std::is_same_v<L, bool>)
    return static_cast<C>(v);
  else if constexpr (std::is_floating_point_v<C>)
    return real<C>(v);
  else
    return integer<C>(v, what);
}

template <class F>
class CallbackOf;

/// A callback of a Lucent function of type Fn<R(A...)>, released on its context.
template <class R, class... A>
class CallbackOf<Fn<R(A...)>> final : public CallbackState {
 public:
  CallbackOf(const char* what, Lives lives, Fn<R(A...)> fn) : CallbackState(what, lives), fn_(std::move(fn)) {
    if constexpr (!std::is_void_v<R>) result_ = std::string(what) + "'s result";
  }

  ~CallbackOf() override {
    ExecutionContext& c = context();
    if (fn_ && !c.isCurrent()) c.post([f = std::move(fn_)] { (void)f; });
  }

  /// Calls the Lucent function with what C passed, and gives C its result.
  template <class CR, class... K>
  CR give(const K&... args) {
    static_assert(sizeof...(K) == sizeof...(A), "a callback takes what its Lucent function does");

    if constexpr (std::is_void_v<R>) {
      fn_(toLucent<A>(args)...);
      if constexpr (!std::is_void_v<CR>) return CR();
    } else {
      R r = fn_(toLucent<A>(args)...);
      if constexpr (!std::is_void_v<CR>) return toC<CR>(r, result_.c_str());
    }
  }

 private:
  Fn<R(A...)> fn_;
  std::string result_;
};

namespace detail {

/// A call of a callback, as decision 0128 runs it.
template <class CR, class F, class... K>
CR dispatch(const std::shared_ptr<CallbackOf<F>>& s, K... args) {
  if (s->runsHere()) {
    try {
      return s->template give<CR>(args...);
    } catch (...) {
      thrownAtOnce(std::current_exception());
      return CR();
    }
  }

  if constexpr (std::is_void_v<CR>) {
    s->post([s, ... args = std::move(args)] {
      try {
        s->template give<void>(args...);
      } catch (...) {
        reportUncaught(std::current_exception(), "callback");
      }
    });
  } else {
    s->refuse();
    return CR();
  }
}

}  // namespace detail

/// The `void *` C passes back to reach `state`, until it ends; with
/// `withScope`, it ends with its module state too.
void* registerCallback(std::shared_ptr<CallbackState> state, bool withScope);

/// The callback C's `void *` reaches; null once it ended.
std::shared_ptr<CallbackState> registeredCallback(void* context);

/// Ends the callback C's `void *` reaches: later calls do nothing.
void endCallback(void* context);

/// A call C makes of a callback: `context` is the `void *` it passed back,
/// `args` the rest of what it passed, in order. Generated code gives C a
/// function that calls this, for the Lucent function's type `F`.
template <class F, class CR, class... CA>
CR callBack(void* context, CA... args) {
  auto state = registeredCallback(context);
  if (!state) return CR();
  if (state->lives() == Lives::Once) endCallback(context);

  return detail::dispatch<CR>(std::static_pointer_cast<CallbackOf<F>>(std::move(state)), kept(args)...);
}

/// A callback as C++ is given it: any std::function of a signature the
/// Lucent function's arguments and result convert to and from.
template <class F>
class Handoff {
 public:
  explicit Handoff(std::shared_ptr<CallbackOf<F>> state) : state_(std::move(state)) {}

  template <class R, class... A>
  operator std::function<R(A...)>() const {
    return [s = state_](A... args) -> R { return detail::dispatch<R>(s, kept(std::forward<A>(args))...); };
  }

 private:
  std::shared_ptr<CallbackOf<F>> state_;
};

namespace detail {

/// Element `I` of `t`, as a tuple of it, or none for `Skip`.
template <size_t Skip, size_t I, class T>
auto unless(T& t) {
  if constexpr (I == Skip)
    return std::tuple<>();
  else
    return std::tuple<std::tuple_element_t<I, T>>(std::get<I>(t));
}

/// The function C is given, of C's own type: it finds the callback by its
/// `void *` (at `Context`) and passes the rest.
template <class F, size_t Context, class P>
struct Thunk;

template <class F, size_t Context, class R, class... A>
struct Thunk<F, Context, R (*)(A...)> {
  static R call(A... args) {
    auto all = std::forward_as_tuple(args...);
    void* context = std::get<Context>(all);

    return [&]<size_t... I>(std::index_sequence<I...>) -> R {
      return std::apply([context](auto&... rest) -> R { return callBack<F, R>(context, rest...); },
                        std::tuple_cat(unless<Context, I>(all)...));
    }(std::index_sequence_for<A...>{});
  }
};

}  // namespace detail

/// The function C is given for a callback of the Lucent function type `F`:
/// of the type `P` its parameter has (`paramOf`), its `void *` at `Context`.
template <class F, size_t Context, class P>
P thunk(P) {
  return &detail::Thunk<F, Context, P>::call;
}

/// A null value of the type C function `f`'s parameter `I` has.
template <size_t I, class R, class... A>
auto paramOf(R (*)(A...)) {
  return std::tuple_element_t<I, std::tuple<A...>>{};
}

/// A Lucent function a call hands C or C++, as the call holds it: made
/// before the call, done after it.
template <class F>
class Callback {
 public:
  Callback(const char* what, Lives lives, F fn) : state_(std::make_shared<CallbackOf<F>>(what, lives, std::move(fn))) {}
  ~Callback() { end(); }
  Callback(const Callback&) = delete;
  Callback& operator=(const Callback&) = delete;

  /// The `void *` C passes back to it.
  void* context() {
    if (!context_) context_ = registerCallback(state_, state_->lives() != Lives::Call);
    return context_;
  }

  /// It lives until `handle` is destroyed.
  void until(const Handle& handle) {
    handle.whenDestroyed([c = context()] { endCallback(c); });
  }

  /// What C++ is given: it becomes the std::function the parameter is,
  /// each copy of which keeps the callback.
  Handoff<F> function() const { return Handoff<F>(state_); }

  /// After the call: ends what lives for the call, then throws a refusal
  /// made during it.
  void done() {
    end();
    state_->rethrow();
  }

 private:
  void end() {
    if (ended_) return;
    ended_ = true;
    state_->returned();
    if (context_ && state_->lives() == Lives::Call) endCallback(context_);
  }

  const std::shared_ptr<CallbackOf<F>> state_;
  void* context_ = nullptr;
  bool ended_ = false;
};

}  // namespace ext
}  // namespace lucent
