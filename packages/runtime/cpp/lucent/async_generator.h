// Lucent runtime — async generators (`async function*`) and their
// iterators.
//
// An async generator is a C++20 coroutine whose declared return type is
// AsyncIter<T>: it awaits (co_await) and yields (co_yield). Like
// JavaScript's, it starts at its first next(), runs synchronously in that
// call up to its first await or yield, and queues the calls made while it
// runs: each settles, in order, with what the body yields next, or done.
// return() ends it, running its finally blocks from the yield it is
// suspended at (the pending co_yield throws GeneratorReturn).
//
// The iterator owns the coroutine's frame. While the body runs (between a
// resumption and its next yield, through its awaits) the iterator holds
// itself, so a consumer that drops it mid-await doesn't destroy a frame a
// promise's continuation will resume.
#pragma once

#include <coroutine>
#include <deque>
#include <exception>
#include <memory>
#include <utility>

#include "async.h"
#include "core.h"
#include "generator.h"

namespace lucent {

template <class T>
class AsyncIterObject : public Object {
 public:
  /// iterator.next(): what the body gives next, or done.
  virtual Promise<IterResult<T>> next() = 0;
  /// iterator.return(): ends it early, running a generator's finally blocks; done.
  virtual Promise<IterResult<T>> ret() = 0;
};
template <class T>
using AsyncIter = Ref<AsyncIterObject<T>>;

namespace detail {

template <class T>
class AsyncGeneratorIter;

template <class T>
struct AsyncGeneratorPromise {
  /// The iterator that owns the frame: it outlives every resumption (it holds itself while the body runs).
  AsyncGeneratorIter<T>* owner = nullptr;
  bool returning = false;

  AsyncIter<T> get_return_object();
  std::suspend_always initial_suspend() noexcept { return {}; }

  /// The body ended: the request it ran for, and every one queued after it, settle as done.
  struct Final {
    AsyncGeneratorPromise& p;
    bool await_ready() const noexcept { return false; }
    void await_suspend(std::coroutine_handle<>) const noexcept { p.owner->ended(); }
    void await_resume() const noexcept {}
  };
  Final final_suspend() noexcept { return Final{*this}; }

  void return_void() { owner->finish(); }
  void unhandled_exception() {
    try {
      throw;
    } catch (const GeneratorReturn&) {
      // return() finished running the finally blocks.
      owner->finish();
    } catch (...) {
      owner->fail(currentError(std::current_exception()));
    }
  }

  /// `yield v`: settles the request with v, then runs on when another is queued, else suspends.
  struct Yield {
    AsyncGeneratorPromise& p;
    bool await_ready() const noexcept { return false; }
    bool await_suspend(std::coroutine_handle<>) const { return !p.owner->yielded(); }
    void await_resume() const {
      if (p.returning) throw GeneratorReturn{};
    }
  };
  Yield yield_value(T v) {
    owner->give(std::move(v));
    return Yield{*this};
  }
};

template <class T>
class AsyncGeneratorIter final : public AsyncIterObject<T> {
 public:
  using Handle = std::coroutine_handle<AsyncGeneratorPromise<T>>;
  explicit AsyncGeneratorIter(Handle h) : h_(h) { h_.promise().owner = this; }
  ~AsyncGeneratorIter() override {
    if (h_) h_.destroy();
  }

  Promise<IterResult<T>> next() override { return enqueue(false); }
  Promise<IterResult<T>> ret() override { return enqueue(true); }

  // --- what the coroutine's promise reports ----------------------------------------------------

  /// A yielded value settles the request at the front.
  void give(T v) {
    Request r = std::move(requests_.front());
    requests_.pop_front();
    r.promise.resolve(IterResult<T>{false, Opt<T>(std::move(v))});
  }
  /// After a yield: whether the body runs on, for a request queued while it ran.
  bool yielded() {
    if (!requests_.empty()) {
      h_.promise().returning = requests_.front().returning;
      return true;
    }
    state_ = State::SuspendedYield;
    // The body is suspended: nothing resumes it until a request does, so the iterator may go.
    auto hold = std::move(self_);
    return false;
  }
  /// The body returned (or return() ran its finally blocks).
  void finish() { settleDone(); }
  /// The body threw: the request it ran for rejects.
  void fail(Error e) {
    if (!requests_.empty()) {
      Request r = std::move(requests_.front());
      requests_.pop_front();
      r.promise.reject(std::move(e));
    }
  }
  /// At the final suspend point: the rest settle as done, and the iterator may go.
  void ended() {
    state_ = State::Completed;
    settleDone();
    auto hold = std::move(self_);
  }

 private:
  enum class State { SuspendedStart, SuspendedYield, Running, Completed };
  struct Request {
    Promise<IterResult<T>> promise;
    bool returning;
  };

  Promise<IterResult<T>> enqueue(bool returning) {
    Promise<IterResult<T>> p;
    requests_.push_back(Request{p, returning});
    if (state_ != State::Running) resumeNext();
    return p;
  }

  void resumeNext() {
    while (!requests_.empty()) {
      if (state_ == State::Completed) {
        settleDone();
        return;
      }
      const bool returning = requests_.front().returning;
      if (returning && state_ == State::SuspendedStart) {
        // return() before the body started: it never runs.
        state_ = State::Completed;
        continue;
      }
      state_ = State::Running;
      h_.promise().returning = returning;
      self_ = std::static_pointer_cast<AsyncGeneratorIter>(this->shared_from_this());
      h_.resume();
      return;
    }
  }

  void settleDone() {
    while (!requests_.empty()) {
      Request r = std::move(requests_.front());
      requests_.pop_front();
      r.promise.resolve(IterResult<T>{});
    }
  }

  Handle h_;
  State state_ = State::SuspendedStart;
  std::deque<Request> requests_;
  /// The iterator itself, while the body runs.
  Ref<AsyncGeneratorIter> self_;
};

template <class T>
AsyncIter<T> AsyncGeneratorPromise<T>::get_return_object() {
  return std::make_shared<AsyncGeneratorIter<T>>(AsyncGeneratorIter<T>::Handle::from_promise(*this));
}

}  // namespace detail

/// `for await` leaving early: the iterator's return(), awaited.
template <class T>
Promise<IterResult<T>> asyncReturn(const AsyncIter<T>& it) {
  return it->ret();
}

template <class T>
String toJsString(const AsyncIter<T>&) {
  return String::fromLatin1("[object AsyncGenerator]");
}

}  // namespace lucent

/// Coroutines declared to return AsyncIter<T> are async generators.
template <class T, class... Args>
struct std::coroutine_traits<lucent::AsyncIter<T>, Args...> {
  using promise_type = lucent::detail::AsyncGeneratorPromise<T>;
};
