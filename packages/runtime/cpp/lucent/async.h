// Lucent runtime — Promise<T> and async functions (C++20 coroutines).
//
// A Lucent `async function` that awaits is a C++ coroutine returning
// Promise<T>; one that never does is a plain function returning a settled
// or adopted promise (adoptedPromise). Like JavaScript, the body starts
// running immediately, and every `await` suspends and never resumes
// inline: as a microtask of its context once the promise settles there, or
// as a job posted to it when the promise settles on another context (Later
// for a value that is not a promise). So the interleaving matches
// JavaScript's.
//
// Coroutine parameters are always taken by value: a coroutine frame must not
// hold references to its caller's locals.
//
// A promise belongs to the execution context it was made in, and a
// continuation to the context that registered it, where it resumes; a
// coroutine therefore stays on the context it started on.
#pragma once

#include <atomic>
#include <coroutine>
#include <exception>
#include <functional>
#include <memory>
#include <optional>
#include <tuple>
#include <vector>

#include "array.h"
#include "core.h"
#include "jserror.h"
#include "scheduler.h"

namespace lucent {

template <class T>
class Promise;

namespace detail {

template <class T>
using Stored = std::conditional_t<std::is_void_v<T>, Undefined, T>;

/// A continuation and the context that registered it, where it runs.
struct Waiter {
  ContextRef context;
  std::function<void()> run;
  /// Registered without holding its promise (Promise::whenSettled): the
  /// promise is held from its settling until `run` runs.
  bool weak = false;
};

/// Runs `waiter` as a microtask if its context is the calling thread's,
/// else posts it there.
inline void dispatch(Waiter& waiter) {
  ExecutionContext& target = ExecutionContext::of(waiter.context);

  if (target.isCurrent()) {
    target.enqueueMicrotask(std::move(waiter.run));
  } else {
    target.post(std::move(waiter.run));
  }
}

/// Runs `job` as a microtask of the calling context.
inline void queueMicrotaskJob(std::function<void()> job) {
  Waiter w{ExecutionContext::currentRef(), std::move(job)};
  dispatch(w);
}

/// A promise's state changes only on its owner, the context it was made
/// in: settlement or registration from another thread is posted there. Once
/// settled it never changes, so any thread may read it.
template <class T>
struct PromiseState : std::enable_shared_from_this<PromiseState<T>> {
  enum class Status : uint8_t { Pending, Fulfilled, Rejected };

  const ContextRef owner = ExecutionContext::currentRef();
  std::atomic<Status> status{Status::Pending};
  std::optional<Stored<T>> value;
  Error error;
  std::vector<Waiter> waiters;

  Status settledAs() const { return status.load(std::memory_order_acquire); }

  void fulfill(Stored<T> v) {
    if (!onOwner()) {
      toOwner([self = this->shared_from_this(), v = std::move(v)]() mutable { self->fulfill(std::move(v)); });
      return;
    }

    if (status.load(std::memory_order_relaxed) != Status::Pending) return;

    value = std::move(v);
    status.store(Status::Fulfilled, std::memory_order_release);
    flush();
  }

  void reject(Error e) {
    if (!onOwner()) {
      toOwner([self = this->shared_from_this(), e = std::move(e)]() mutable { self->reject(std::move(e)); });
      return;
    }

    if (status.load(std::memory_order_relaxed) != Status::Pending) return;

    error = std::move(e);
    status.store(Status::Rejected, std::memory_order_release);
    flush();
  }

  /// Runs `f` once settled, as a microtask of the calling thread's context
  /// (the shared actor outside any).
  void onSettled(std::function<void()> f, bool weak = false) {
    Waiter waiter{ExecutionContext::currentRef(), std::move(f), weak};

    if (onOwner()) {
      add(std::move(waiter));
      return;
    }

    if (settledAs() != Status::Pending) {
      dispatchHeld(waiter);
      return;
    }

    toOwner([self = this->shared_from_this(), waiter = std::move(waiter)]() mutable { self->add(std::move(waiter)); });
  }

 private:
  bool onOwner() const { return ExecutionContext::of(owner).isCurrent(); }

  /// Dropped, with what it carries, if the owner has shut down.
  void toOwner(Job job) { ExecutionContext::of(owner).post(std::move(job)); }

  /// A registration posted from another context, now on the owner.
  void add(Waiter waiter) {
    if (status.load(std::memory_order_relaxed) == Status::Pending) {
      waiters.push_back(std::move(waiter));
    } else {
      dispatchHeld(waiter);
    }
  }

  void flush() {
    auto ws = std::move(waiters);
    waiters.clear();
    for (auto& w : ws) dispatchHeld(w);
  }

  /// Dispatches `w`, holding this promise until it runs if its registration doesn't.
  void dispatchHeld(Waiter& w) {
    if (w.weak) w.run = [self = this->shared_from_this(), run = std::move(w.run)]() mutable { run(); };
    dispatch(w);
  }
};

template <class T>
struct PromiseTypeBase {
  std::shared_ptr<PromiseState<T>> state = std::make_shared<PromiseState<T>>();
  Promise<T> get_return_object();
  std::suspend_never initial_suspend() noexcept { return {}; }
  // The frame frees itself when the body finishes; the Promise handle only
  // shares the settled state.
  std::suspend_never final_suspend() noexcept { return {}; }
  void unhandled_exception() { state->reject(currentError(std::current_exception())); }
};

template <class T>
struct PromiseType : PromiseTypeBase<T> {
  void return_value(T v) { this->state->fulfill(std::move(v)); }
};
template <>
struct PromiseType<void> : PromiseTypeBase<void> {
  void return_void() { this->state->fulfill(undefined); }
};

}  // namespace detail

/// Promise<T>: a handle to a settled-or-pending value. Copies share state.
template <class T>
class Promise {
 public:
  using promise_type = detail::PromiseType<T>;
  using State = detail::PromiseState<T>;
  using value_type = T;

  Promise() : s_(std::make_shared<State>()) {}
  explicit Promise(std::shared_ptr<State> s) : s_(std::move(s)) {}

  // A new state is not shared yet: it settles here, whatever its owner.
  static Promise resolved(detail::Stored<T> v) {
    Promise p;
    p.s_->value = std::move(v);
    p.s_->status.store(State::Status::Fulfilled, std::memory_order_relaxed);
    return p;
  }
  static Promise resolved()
    requires std::is_void_v<T>
  {
    return resolved(undefined);
  }
  static Promise rejected(Error e) {
    Promise p;
    p.s_->error = std::move(e);
    p.s_->status.store(State::Status::Rejected, std::memory_order_relaxed);
    return p;
  }

  void resolve(detail::Stored<T> v) const { s_->fulfill(std::move(v)); }
  void reject(Error e) const { s_->reject(std::move(e)); }
  bool settled() const { return s_->settledAs() != State::Status::Pending; }
  bool fulfilled() const { return s_->settledAs() == State::Status::Fulfilled; }
  const detail::Stored<T>& value() const { return *s_->value; }
  const Error& error() const { return s_->error; }
  void onSettled(std::function<void()> f) const { s_->onSettled(std::move(f)); }

  /// Runs `f(promise)` once settled, as onSettled does, without the
  /// registration holding the promise: one that never settles goes when
  /// nothing else holds it, and what waits on it with it.
  template <class F>
  void whenSettled(F f) const {
    std::weak_ptr<State> weak = s_;
    s_->onSettled(
        [weak, f = std::move(f)]() mutable {
          if (auto s = weak.lock()) f(Promise(std::move(s)));
        },
        true);
  }

  // Awaitable: JavaScript never resumes an await synchronously.
  bool await_ready() const noexcept { return false; }
  void await_suspend(std::coroutine_handle<> h) const {
    s_->onSettled([h]() mutable { h.resume(); });
  }
  T await_resume() const {
    if (s_->settledAs() == State::Status::Rejected) throw Exception(s_->error);
    if constexpr (!std::is_void_v<T>) return *s_->value;
  }

  const void* identity() const { return s_.get(); }

 private:
  std::shared_ptr<State> s_;
};

template <class T>
String toJsString(const Promise<T>&) {
  return String::fromLatin1("[object Promise]");
}

/// `===`: the same promise.
template <class T>
bool strictEquals(const Promise<T>& a, const Promise<T>& b) {
  return a.identity() == b.identity();
}

template <class T>
Promise<T> detail::PromiseTypeBase<T>::get_return_object() {
  return Promise<T>(state);
}

template <class T>
struct IsPromise : std::false_type {};
template <class T>
struct IsPromise<Promise<T>> : std::true_type {};

/// `Promise.resolve(x)` where x is not a promise.
template <class T>
Promise<T> resolvedPromise(T v) {
  return Promise<T>::resolved(std::move(v));
}

/// `await x` where x is not a promise: x, a microtask later, as JavaScript
/// awaits a promise resolved with it. The awaiter, and x with it, lives in
/// the coroutine's frame while it waits.
template <class T>
struct Later {
  T value;

  bool await_ready() const noexcept { return false; }
  void await_suspend(std::coroutine_handle<> h) const {
    detail::queueMicrotaskJob([h]() mutable { h.resume(); });
  }
  T await_resume() { return std::move(value); }
};

template <class T>
Later<T> later(T v) {
  return Later<T>{std::move(v)};
}

namespace detail {
/// Promise.all's bookkeeping: `out` rejects with the first input to reject,
/// and fulfils with `finish(values)` in the reaction of the last input to
/// fulfil. Every input is observed at once, as in JavaScript.
template <class R, class Values, class Finish>
struct AllState {
  Promise<R> out;
  Values values;
  size_t remaining;
  Finish finish;

  template <class T>
  void watch(const Promise<T>& p, std::optional<Stored<T>>& slot, const std::shared_ptr<AllState>& self) {
    p.whenSettled([&slot, self](const Promise<T>& p) {
      if (!p.fulfilled()) {
        self->out.reject(p.error());
        return;
      }
      slot = p.value();
      if (--self->remaining == 0) self->out.resolve(self->finish(self->values));
    });
  }
};
}  // namespace detail

/// Promise.all over promises of one type.
template <class T>
Promise<Array<T>> promiseAll(Array<Promise<T>> promises) {
  using Values = std::vector<std::optional<T>>;
  auto finish = [](Values& vs) {
    Array<T> r;
    for (auto& v : vs) r.push(std::move(*v));
    return r;
  };
  using State = detail::AllState<Array<T>, Values, decltype(finish)>;
  auto st = std::make_shared<State>(State{{}, Values(promises.size()), promises.size(), finish});
  if (st->remaining == 0) st->out.resolve(Array<T>{});
  size_t i = 0;
  for (const auto& p : promises.items()) st->watch(p, st->values[i++], st);
  return st->out;
}
inline Promise<void> promiseAllVoid(Array<Promise<void>> promises) {
  using Values = std::vector<std::optional<Undefined>>;
  auto finish = [](Values&) { return undefined; };
  using State = detail::AllState<void, Values, decltype(finish)>;
  auto st = std::make_shared<State>(State{{}, Values(promises.size()), promises.size(), finish});
  if (st->remaining == 0) st->out.resolve(undefined);
  size_t i = 0;
  for (const auto& p : promises.items()) st->watch(p, st->values[i++], st);
  return st->out;
}

/// Promise.all over a tuple of promises of different types.
template <class... Ts>
Promise<std::tuple<detail::Stored<Ts>...>> promiseAllTuple(std::tuple<Promise<Ts>...> ps) {
  using Values = std::tuple<std::optional<detail::Stored<Ts>>...>;
  auto finish = [](Values& vs) {
    return std::apply([](auto&... v) { return std::tuple<detail::Stored<Ts>...>{std::move(*v)...}; }, vs);
  };
  using State = detail::AllState<std::tuple<detail::Stored<Ts>...>, Values, decltype(finish)>;
  auto st = std::make_shared<State>(State{{}, Values{}, sizeof...(Ts), finish});
  if constexpr (sizeof...(Ts) == 0) {
    st->out.resolve({});
  } else {
    [&]<size_t... I>(std::index_sequence<I...>) {
      (st->watch(std::get<I>(ps), std::get<I>(st->values), st), ...);
    }(std::index_sequence_for<Ts...>{});
  }
  return st->out;
}

// --- then, catch and finally ------------------------------------------------------------
//
// Each settles its promise in the microtask JavaScript does: a handler runs
// in the reaction to its promise, and a promise it returns is adopted two
// microtasks later (a thenable job, then the adopted promise's reaction).

namespace detail {

/// Settles `out` as `from` settled.
template <class R, class U>
void settleFrom(const Promise<R>& out, const Promise<U>& from) {
  if (!from.fulfilled()) {
    out.reject(from.error());
  } else if constexpr (std::is_void_v<R>) {
    out.resolve(undefined);
  } else if constexpr (std::is_void_v<U>) {
    // A promise typed never (Promise.reject's) fulfils no value.
    out.reject(makeError(String::fromLatin1("TypeError"), String::fromLatin1("a promise of no value fulfilled")));
  } else {
    out.resolve(Stored<R>(from.value()));
  }
}

/// Settles `out` with what a handler gave: a value at once, or a promise it
/// adopts, as JavaScript's promise resolve functions do.
template <class R, class X>
void settleWith(const Promise<R>& out, X x) {
  if constexpr (IsPromise<X>::value) {
    queueMicrotaskJob([out, x] { x.whenSettled([out](const X& p) { settleFrom(out, p); }); });
  } else if constexpr (std::is_void_v<R>) {
    out.resolve(undefined);
  } else {
    out.resolve(Stored<R>(std::move(x)));
  }
}

/// Calls a fulfilment handler with `p`'s value, or none for a Promise<void>.
template <class T, class F>
auto callWithValue(F& f, const Promise<T>& p) {
  if constexpr (std::is_void_v<T>)
    return f();
  else
    return f(p.value());
}

/// Calls `f` for what it returns, Undefined in place of void.
template <class F, class... A>
auto returned(F&& f, A&&... a) {
  if constexpr (std::is_void_v<decltype(f(std::forward<A>(a)...))>) {
    f(std::forward<A>(a)...);
    return undefined;
  } else {
    return f(std::forward<A>(a)...);
  }
}

}  // namespace detail

/// `p.then()` or `p.catch()` without a handler: `p`'s outcome, in its reaction.
template <class R, class T>
Promise<R> promisePass(const Promise<T>& p) {
  Promise<R> out;
  p.whenSettled([out](const Promise<T>& p) { detail::settleFrom(out, p); });
  return out;
}

/// `p.then(onFulfilled)`: what the handler gives, or `p`'s rejection.
template <class R, class T, class F>
Promise<R> promiseThen(const Promise<T>& p, F onFulfilled) {
  Promise<R> out;
  p.whenSettled([out, onFulfilled](const Promise<T>& p) mutable {
    if (!p.fulfilled()) {
      out.reject(p.error());
      return;
    }
    try {
      detail::settleWith(out, detail::returned([&] { return detail::callWithValue(onFulfilled, p); }));
    } catch (...) {
      out.reject(currentError(std::current_exception()));
    }
  });
  return out;
}

/// `p.then(onFulfilled, onRejected)`.
template <class R, class T, class F, class G>
Promise<R> promiseThen(const Promise<T>& p, F onFulfilled, G onRejected) {
  Promise<R> out;
  p.whenSettled([out, onFulfilled, onRejected](const Promise<T>& p) mutable {
    try {
      if (p.fulfilled())
        detail::settleWith(out, detail::returned([&] { return detail::callWithValue(onFulfilled, p); }));
      else
        detail::settleWith(out, detail::returned(onRejected, p.error()));
    } catch (...) {
      out.reject(currentError(std::current_exception()));
    }
  });
  return out;
}

/// `p.catch(onRejected)`: `p`'s value, or what the handler gives.
template <class R, class T, class G>
Promise<R> promiseCatch(const Promise<T>& p, G onRejected) {
  Promise<R> out;
  p.whenSettled([out, onRejected](const Promise<T>& p) mutable {
    try {
      if (p.fulfilled())
        detail::settleFrom(out, p);
      else
        detail::settleWith(out, detail::returned(onRejected, p.error()));
    } catch (...) {
      out.reject(currentError(std::current_exception()));
    }
  });
  return out;
}

/// `p.finally(onFinally)`: `p`'s outcome once the handler (and a promise it
/// returns) is done, or the handler's own rejection. In JavaScript's
/// microtasks: the handler's result resolved, then `p`'s outcome, adopted.
template <class T, class F>
Promise<T> promiseFinally(const Promise<T>& p, F onFinally) {
  Promise<T> out;
  p.whenSettled([out, onFinally](const Promise<T>& p) mutable {
    try {
      auto result = detail::returned(onFinally);
      // PromiseResolve(result) (a promise is itself; a value, one resolved
      // with it), `.then(() => value)` or `.then(() => { throw reason })` on
      // it, and that promise adopted.
      Promise<T> next;
      auto done = [p, next](bool ok, const Error& e) {
        if (!ok) next.reject(e);
        else detail::settleFrom(next, p);
      };
      if constexpr (IsPromise<decltype(result)>::value)
        result.whenSettled([done](const auto& r) { done(r.fulfilled(), r.fulfilled() ? Error() : r.error()); });
      else
        Promise<void>::resolved().onSettled([done] { done(true, Error()); });
      detail::settleWith(out, next);
    } catch (...) {
      out.reject(currentError(std::current_exception()));
    }
  });
  return out;
}

// --- race, any and allSettled --------------------------------------------------------------
//
// Each observes every input at once, as Promise.all does, and settles in
// the reaction of the input that decides it. Over a tuple, each input's
// converter gives its value as the result's type (asIs: already of it).

/// What Promise.any rejects with when every input rejected: their reasons,
/// in input order.
struct AggregateErrorObject : ErrorObject {
  Array<Error> errors;
};

inline Error makeAggregateError(Array<Error> errors) {
  auto e = std::make_shared<AggregateErrorObject>();
  e->name = String::fromLatin1("AggregateError");
  e->message = String::fromLatin1("All promises were rejected");
  e->errors = std::move(errors);
  return e;
}

/// `e.errors` of an AggregateError (none, for another error).
inline Array<Error> aggregateErrors(const Error& e) {
  if (auto a = std::dynamic_pointer_cast<AggregateErrorObject>(e)) return a->errors;
  return Array<Error>{};
}

namespace detail {

struct AsIs {};

/// Settles `out` as `p` settled, `convert` giving its value as `out`'s.
template <class R, class T, class C>
void settleConverted(const Promise<R>& out, const Promise<T>& p, const C& convert) {
  if constexpr (std::is_same_v<C, AsIs>) {
    settleFrom(out, p);
  } else if (p.fulfilled()) {
    out.resolve(convert(p.value()));
  } else {
    out.reject(p.error());
  }
}

/// Calls `f(input, converter, index)` for each input of a tuple.
template <class... Ts, class... Cs, class F>
void eachInput(const std::tuple<Promise<Ts>...>& ps, const std::tuple<Cs...>& cs, F f) {
  static_assert(sizeof...(Ts) == sizeof...(Cs), "a converter for each input");
  [&]<size_t... I>(std::index_sequence<I...>) { (f(std::get<I>(ps), std::get<I>(cs), I), ...); }(std::index_sequence_for<Ts...>{});
}

template <class R>
struct AnyState {
  Promise<R> out;
  std::vector<Error> errors;
  size_t remaining;

  template <class T, class C>
  void watch(const Promise<T>& p, const C& convert, size_t i, const std::shared_ptr<AnyState>& self) {
    p.whenSettled([convert, i, self](const Promise<T>& p) {
      if (p.fulfilled()) {
        settleConverted(self->out, p, convert);
        return;
      }
      self->errors[i] = p.error();
      if (--self->remaining == 0) {
        Array<Error> all;
        for (auto& e : self->errors) all.push(std::move(e));
        self->out.reject(makeAggregateError(std::move(all)));
      }
    });
  }
};

/// Promise.allSettled's bookkeeping: each input's outcome, made by
/// `fulfilled` or `rejected`, fills its slot; `out` fulfils with them in
/// the reaction of the last input to settle.
template <class R, class Values, class Finish>
struct SettledState {
  Promise<R> out;
  Values values;
  size_t remaining;
  Finish finish;

  template <class T, class Slot, class F, class G>
  void watch(const Promise<T>& p, Slot& slot, F fulfilled, G rejected, const std::shared_ptr<SettledState>& self) {
    p.whenSettled([&slot, fulfilled, rejected, self](const Promise<T>& p) {
      if (p.fulfilled())
        slot = fulfilled(p.value());
      else
        slot = rejected(p.error());
      if (--self->remaining == 0) self->out.resolve(self->finish(self->values));
    });
  }
};

}  // namespace detail

inline constexpr detail::AsIs asIs{};

/// Promise.race over promises of one type: as the first to settle settles.
template <class T>
Promise<T> promiseRace(Array<Promise<T>> promises) {
  Promise<T> out;
  for (const auto& p : promises.items()) p.whenSettled([out](const Promise<T>& q) { detail::settleFrom(out, q); });
  return out;
}

/// Promise.race over a tuple, each input's value converted to R.
template <class R, class... Ts, class... Cs>
Promise<R> promiseRaceTuple(std::tuple<Promise<Ts>...> ps, Cs... convert) {
  Promise<R> out;
  detail::eachInput(ps, std::make_tuple(convert...), [&](const auto& p, const auto& c, size_t) {
    p.whenSettled([out, c](const auto& q) { detail::settleConverted(out, q, c); });
  });
  return out;
}

/// Promise.any over promises of one type: as the first to fulfil, or an
/// AggregateError once all rejected (at once, given none).
template <class T>
Promise<T> promiseAny(Array<Promise<T>> promises) {
  using State = detail::AnyState<T>;
  auto st = std::make_shared<State>(State{{}, std::vector<Error>(promises.size()), promises.size()});
  if (st->remaining == 0) st->out.reject(makeAggregateError(Array<Error>{}));
  size_t i = 0;
  for (const auto& p : promises.items()) st->watch(p, asIs, i++, st);
  return st->out;
}

/// Promise.any over a tuple, each input's value converted to R.
template <class R, class... Ts, class... Cs>
Promise<R> promiseAnyTuple(std::tuple<Promise<Ts>...> ps, Cs... convert) {
  using State = detail::AnyState<R>;
  auto st = std::make_shared<State>(State{{}, std::vector<Error>(sizeof...(Ts)), sizeof...(Ts)});
  if constexpr (sizeof...(Ts) == 0) st->out.reject(makeAggregateError(Array<Error>{}));
  detail::eachInput(ps, std::make_tuple(convert...), [&](const auto& p, const auto& c, size_t i) { st->watch(p, c, i, st); });
  return st->out;
}

/// Promise.allSettled over promises of one type: each one's outcome,
/// `fulfilled(value)` or `rejected(error)`, a PromiseSettledResult.
template <class R, class T, class F, class G>
Promise<Array<R>> promiseAllSettled(Array<Promise<T>> promises, F fulfilled, G rejected) {
  using Values = std::vector<std::optional<R>>;
  auto finish = [](Values& vs) {
    Array<R> r;
    for (auto& v : vs) r.push(std::move(*v));
    return r;
  };
  using State = detail::SettledState<Array<R>, Values, decltype(finish)>;
  auto st = std::make_shared<State>(State{{}, Values(promises.size()), promises.size(), finish});
  if (st->remaining == 0) st->out.resolve(Array<R>{});
  size_t i = 0;
  for (const auto& p : promises.items()) st->watch(p, st->values[i++], fulfilled, rejected, st);
  return st->out;
}

/// Promise.allSettled over a tuple: each input's outcome, by its own pair
/// of functions.
template <class... Ts, class... Fs, class... Gs>
auto promiseAllSettledTuple(std::tuple<Promise<Ts>...> ps, std::tuple<Fs...> fs, std::tuple<Gs...> gs) {
  using Result = std::tuple<std::invoke_result_t<Fs, const detail::Stored<Ts>&>...>;
  using Values = std::tuple<std::optional<std::invoke_result_t<Fs, const detail::Stored<Ts>&>>...>;
  auto finish = [](Values& vs) { return std::apply([](auto&... v) { return Result{std::move(*v)...}; }, vs); };
  using State = detail::SettledState<Result, Values, decltype(finish)>;
  auto st = std::make_shared<State>(State{{}, Values{}, sizeof...(Ts), finish});
  if constexpr (sizeof...(Ts) == 0) {
    st->out.resolve(Result{});
  } else {
    [&]<size_t... I>(std::index_sequence<I...>) {
      (st->watch(std::get<I>(ps), std::get<I>(st->values), std::get<I>(fs), std::get<I>(gs), st), ...);
    }(std::index_sequence_for<Ts...>{});
  }
  return st->out;
}

// --- return p ---------------------------------------------------------------------------
//
// An async function that returns a promise resolves its own with it: a
// thenable job, then the returned promise's reaction, settle it, after the
// function has finished (its finally blocks run first, and its catch blocks
// never see the returned promise's rejection).

namespace detail {

/// What settles an async function's promise `out` from the `p` it returned.
template <class R, class U>
auto adopting(Promise<U> p) {
  return [p = std::move(p)](const Promise<R>& out) { settleWith(out, p); };
}

/// The same, a promise of another type than the function's: `convert`
/// converts what it fulfils with.
template <class R, class U, class C>
auto adopting(Promise<U> p, C convert) {
  return [p = std::move(p), convert = std::move(convert)](const Promise<R>& out) {
    queueMicrotaskJob([out, p, convert] {
      p.whenSettled([out, convert](const Promise<U>& p) {
        if (p.fulfilled())
          out.resolve(convert(p.value()));
        else
          out.reject(p.error());
      });
    });
  };
}

}  // namespace detail

/// An eager async function's (one that never awaits) `return p`.
template <class R, class U, class... C>
Promise<R> adoptedPromise(Promise<U> p, C... convert) {
  Promise<R> out;
  detail::adopting<R>(std::move(p), std::move(convert)...)(out);
  return out;
}

/// A coroutine's `return p`: `co_return co_await lucent::adopt<R>(p);`,
/// R its result, ends the coroutine, its frame destroyed as at a return,
/// and settles its promise from `p`. It never resumes.
template <class R, class Settle>
struct Adopt {
  Settle settle;

  bool await_ready() const noexcept { return false; }

  template <class P>
  void await_suspend(std::coroutine_handle<P> h) {
    Promise<R> out(h.promise().state);
    // This awaiter lives in the frame destroyed next.
    Settle s = std::move(settle);
    h.destroy();
    s(out);
  }

  [[noreturn]] R await_resume() const { unreachable(); }
};

template <class R, class U, class... C>
auto adopt(Promise<U> p, C... convert) {
  auto settle = detail::adopting<R>(std::move(p), std::move(convert)...);
  return Adopt<R, decltype(settle)>{std::move(settle)};
}

/// `await delay(ms)` — resolves after `ms` milliseconds on the calling
/// context; rejects with an AbortError if the scope its work belongs to is
/// disposed first (ownedScope: a reload, for module code).
Promise<void> delay(double ms);

}  // namespace lucent
