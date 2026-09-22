// Lucent runtime — Promise<T> and async functions (C++20 coroutines).
//
// A Lucent `async function` is a C++ coroutine returning Promise<T>. Like
// JavaScript, the body starts running immediately and every `await`
// suspends, resuming later from the microtask queue (never inline), so the
// interleaving matches JavaScript's.
//
// Coroutine parameters are always taken by value: a coroutine frame must not
// hold references to its caller's locals.
#pragma once

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

template <class T>
struct PromiseState {
  enum class Status : uint8_t { Pending, Fulfilled, Rejected };
  Status status = Status::Pending;
  std::optional<Stored<T>> value;
  Error error;
  std::vector<std::function<void()>> waiters;

  void fulfill(Stored<T> v) {
    if (status != Status::Pending) return;
    value = std::move(v);
    status = Status::Fulfilled;
    flush();
  }
  void reject(Error e) {
    if (status != Status::Pending) return;
    error = std::move(e);
    status = Status::Rejected;
    flush();
  }
  /// Runs `f` as a microtask once settled. Callers hold the Lucent lock.
  void onSettled(std::function<void()> f) {
    if (status == Status::Pending) waiters.push_back(std::move(f));
    else Scheduler::instance().enqueueMicrotask(std::move(f));
  }

 private:
  void flush() {
    auto ws = std::move(waiters);
    waiters.clear();
    for (auto& w : ws) Scheduler::instance().enqueueMicrotask(std::move(w));
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

  static Promise resolved(detail::Stored<T> v) {
    Promise p;
    p.s_->fulfill(std::move(v));
    return p;
  }
  static Promise resolved()
    requires std::is_void_v<T>
  {
    Promise p;
    p.s_->fulfill(undefined);
    return p;
  }
  static Promise rejected(Error e) {
    Promise p;
    p.s_->reject(std::move(e));
    return p;
  }

  void resolve(detail::Stored<T> v) const { s_->fulfill(std::move(v)); }
  void reject(Error e) const { s_->reject(std::move(e)); }
  bool settled() const { return s_->status != State::Status::Pending; }
  bool fulfilled() const { return s_->status == State::Status::Fulfilled; }
  const detail::Stored<T>& value() const { return *s_->value; }
  const Error& error() const { return s_->error; }
  void onSettled(std::function<void()> f) const { s_->onSettled(std::move(f)); }

  // Awaitable: JavaScript never resumes an await synchronously.
  bool await_ready() const noexcept { return false; }
  void await_suspend(std::coroutine_handle<> h) const {
    s_->onSettled([h]() mutable { h.resume(); });
  }
  T await_resume() const {
    if (s_->status == State::Status::Rejected) throw Exception(s_->error);
    if constexpr (!std::is_void_v<T>) return *s_->value;
  }

  const void* identity() const { return s_.get(); }
  friend bool strictEquals(const Promise& a, const Promise& b) { return a.s_ == b.s_; }
  friend String toJsString(const Promise&) { return String::fromLatin1("[object Promise]"); }

 private:
  std::shared_ptr<State> s_;
};

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

/// Promise.all over promises of one type.
template <class T>
Promise<Array<T>> promiseAll(Array<Promise<T>> promises) {
  Array<T> out;
  for (const auto& p : promises.items()) out.push(co_await p);
  co_return out;
}
inline Promise<void> promiseAllVoid(Array<Promise<void>> promises) {
  for (const auto& p : promises.items()) co_await p;
}

namespace detail {
template <class T>
Promise<Stored<T>> stored(Promise<T> p) {
  if constexpr (std::is_void_v<T>) {
    co_await p;
    co_return undefined;
  } else {
    co_return co_await p;
  }
}
}  // namespace detail

/// Promise.all over a tuple of promises of different types.
template <class... Ts>
Promise<std::tuple<detail::Stored<Ts>...>> promiseAllTuple(std::tuple<Promise<Ts>...> ps) {
  auto collect = [](std::tuple<Promise<Ts>...> ps) -> Promise<std::tuple<detail::Stored<Ts>...>> {
    co_return co_await std::apply(
        [](auto... p) -> Promise<std::tuple<detail::Stored<Ts>...>> {
          co_return std::tuple<detail::Stored<Ts>...>{co_await detail::stored(p)...};
        },
        ps);
  };
  return collect(ps);
}

/// `await delay(ms)` — resolves after `ms` milliseconds on the Lucent thread.
Promise<void> delay(double ms);

}  // namespace lucent
