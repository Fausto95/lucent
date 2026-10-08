// Lucent runtime — Promise<T> and async functions (C++20 coroutines).
//
// A Lucent `async function` is a C++ coroutine returning Promise<T>. Like
// JavaScript, the body starts running immediately and every `await`
// suspends, resuming later from the microtask queue (never inline), so the
// interleaving matches JavaScript's.
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
  /// (the legacy module context outside any).
  void onSettled(std::function<void()> f) {
    Waiter waiter{ExecutionContext::currentRef(), std::move(f)};

    if (onOwner()) {
      add(std::move(waiter));
      return;
    }

    if (settledAs() != Status::Pending) {
      dispatch(waiter);
      return;
    }

    toOwner([self = this->shared_from_this(), waiter = std::move(waiter)]() mutable { self->add(std::move(waiter)); });
  }

 private:
  bool onOwner() const { return owner ? owner->isCurrent() : Scheduler::lock().heldByCurrentThread(); }

  /// Dropped, with what it carries, if the owner has shut down.
  void toOwner(Job job) { ExecutionContext::of(owner).post(std::move(job)); }

  /// A registration posted from another context, now on the owner.
  void add(Waiter waiter) {
    if (status.load(std::memory_order_relaxed) == Status::Pending) {
      waiters.push_back(std::move(waiter));
    } else {
      dispatch(waiter);
    }
  }

  void flush() {
    auto ws = std::move(waiters);
    waiters.clear();
    for (auto& w : ws) dispatch(w);
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

/// `await x` where x is not a promise.
template <class T>
Promise<T> resolvedPromise(T v) {
  return Promise<T>::resolved(std::move(v));
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
    p.onSettled([p, &slot, self] {
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

/// `await delay(ms)` — resolves after `ms` milliseconds on the calling
/// context; rejects with an AbortError if the scope its work belongs to is
/// disposed first (ownedScope: a reload, for module code).
Promise<void> delay(double ms);

}  // namespace lucent
