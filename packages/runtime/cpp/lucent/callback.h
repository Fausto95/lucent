// Lucent runtime — composing callbacks into promises and subscriptions.
//
// fromCallback turns an API that reports once through callbacks into a
// promise; subscribe delivers what a listener reports until it ends. Neither
// knows what it listens to: Lucent code starts listening (the registration)
// and returns what stops it (the cleanup).
//
// Each is one Operation (scope.h) under the calling context's root scope.
// It settles exactly once, at the first of its callbacks, its signal
// aborting and the scope's disposal; whatever comes later is dropped. Its
// cleanup runs exactly once, as soon as it settles, or as soon as the
// registration returns it if it settled during registration.
//
// Everything it runs belongs to its owner, the context it was called on:
// the registration, the value handler, the cleanup and the promise. The
// functions it hands to Lucent code may be called from any thread: from
// another, a call is posted to the owner, after those posted before it,
// and takes effect when it runs there.
#pragma once

#include <exception>
#include <functional>
#include <memory>
#include <tuple>
#include <utility>

#include "abort.h"
#include "async.h"
#include "core.h"
#include "execution.h"
#include "function.h"
#include "jserror.h"
#include "scope.h"

namespace lucent {

namespace detail {

/// Cancels with the signal's reason when it aborts, until the returned
/// function stops following it. `cancel` runs on the signal's context.
std::function<void()> followSignal(const AbortSignal& signal, std::function<void(Error)> cancel);

/// The reason an already aborted signal gives; none otherwise.
Opt<Error> abortedBy(const Opt<AbortSignal>& signal);

/// Makes the function of type `F` handed to Lucent code, passing what it
/// is called with to `sink`.
template <class F>
struct Handout;

template <class... A>
struct Handout<Fn<void(A...)>> {
  template <class Sink>
  static Fn<void(A...)> make(Sink sink) {
    return Fn<void(A...)>([sink = std::move(sink)](A... args) mutable { sink(std::move(args)...); });
  }
};

/// One composition's operation and owner, shared by what it hands out.
template <class T>
class Composition : public std::enable_shared_from_this<Composition<T>> {
 public:
  using Op = Operation<T>;
  using Value = typename Op::Value;

  Composition(ContextRef owner, std::shared_ptr<Op> op) : owner_(std::move(owner)), op_(std::move(op)) {}

  /// Settles on the owner; the first settlement wins.
  void succeed(Value value) {
    if constexpr (std::is_void_v<T>) {
      onOwner([](Op& op) { op.succeed(); });
    } else {
      onOwner([value = std::move(value)](Op& op) mutable { op.succeed(std::move(value)); });
    }
  }

  void fail(Error error) {
    onOwner([error = std::move(error)](Op& op) mutable { op.fail(std::move(error)); });
  }

  /// Runs `deliver` on the owner while the operation is pending. What it
  /// throws settles the operation as failed.
  template <class Deliver>
  void deliver(Deliver deliver) {
    onOwner([deliver = std::move(deliver)](Op& op) mutable {
      if (op.state() != OperationState::Pending) return;

      try {
        deliver();
      } catch (...) {
        op.fail(currentError(std::current_exception()));
      }
    });
  }

  /// Cancels with `signal`'s reason when it aborts, until settlement.
  void follow(const Opt<AbortSignal>& signal) {
    if (!signal.has() || !signal.get()) return;

    auto self = this->shared_from_this();
    auto unfollow = followSignal(signal.get(), [self](Error reason) {
      self->onOwner([reason = std::move(reason)](Op& op) mutable { op.cancel(std::move(reason)); });
    });

    op_->onSettled([unfollow = std::move(unfollow)](const typename Op::Outcome&) { unfollow(); });
  }

 private:
  /// Runs `f` with the operation on the owner: now, on the owner's thread,
  /// else posted there (and dropped if the owner takes no more work).
  template <class F>
  void onOwner(F f) {
    ExecutionContext& owner = ExecutionContext::of(owner_);

    if (owner.isCurrent()) {
      f(*op_);
      return;
    }

    owner.post([self = this->shared_from_this(), f = std::move(f)]() mutable { f(*self->op_); });
  }

  const ContextRef owner_;
  const std::shared_ptr<Op> op_;
};

/// The cleanup a registration returned (a function, maybe absent), as the
/// operation runs it; what the cleanup returns is ignored.
template <class Returned>
std::function<void()> cleanupOf(const Returned& returned) {
  if constexpr (IsOpt<Returned>::value) {
    if (!returned.has()) return {};

    return cleanupOf(returned.get());
  } else {
    if (!returned) return {};

    return [f = returned] { f(); };
  }
}

/// Calls the registration and takes its cleanup, if it returns one.
template <class Returned, class... Handed>
std::function<void()> registerWith(const Fn<Returned(Handed...)>& registration, Handed... handed) {
  if constexpr (std::is_void_v<Returned>) {
    registration(std::move(handed)...);
    return {};
  } else {
    return cleanupOf(registration(std::move(handed)...));
  }
}

/// Starts an operation of the calling context that `start` registers (with
/// the composition), following `signal`, and the promise it settles.
template <class T, class Start>
Promise<T> compose(const Opt<AbortSignal>& signal, Start start) {
  using Op = Operation<T>;

  ContextRef owner = ExecutionContext::currentRef();
  Promise<T> promise;

  auto op = Op::start(
      ExecutionContext::of(owner).root(),
      [&](const std::shared_ptr<Op>& op) {
        auto composition = std::make_shared<Composition<T>>(owner, op);

        composition->follow(signal);

        return start(composition);
      },
      abortedBy(signal));

  op->onSettled([promise](const typename Op::Outcome& outcome) {
    if (outcome.state == OperationState::Succeeded) {
      promise.resolve(*outcome.value);
    } else {
      promise.reject(outcome.error);
    }
  });

  return promise;
}

}  // namespace detail

/// `fromCallback(register, signal)` (lucent:core): calls `registration`
/// with `resolve` and `reject`, and returns the promise the first of them,
/// or the signal, settles. A registration that throws rejects it; it
/// returns its cleanup (a Fn taking nothing, maybe in an Opt) or nothing.
/// `Resolve` is `Fn<void(T)>`, or `Fn<void()>` when T is void.
template <class T, class Resolve, class Returned>
Promise<T> fromCallback(const Fn<Returned(Resolve, Fn<void(Error)>)>& registration, Opt<AbortSignal> signal = {}) {
  using Composition = detail::Composition<T>;

  return detail::compose<T>(signal, [&](const std::shared_ptr<Composition>& c) {
    auto resolve = detail::Handout<Resolve>::make([c](auto... value) {
      static_assert(sizeof...(value) <= 1, "resolve takes one value");

      c->succeed(typename Composition::Value(std::move(value)...));
    });
    Fn<void(Error)> reject = [c](Error error) { c->fail(std::move(error)); };

    return detail::registerWith(registration, std::move(resolve), std::move(reject));
  });
}

/// `subscribe(register, onValue, signal)` (lucent:core): calls
/// `registration` with `next`, `end` and `fail`; `next` calls `onValue`
/// until the subscription ends, at the first of `end`, `fail`, `onValue`
/// throwing and the signal. Returns the promise of that end. What
/// `onValue` returns is ignored.
template <class Next, class Returned, class OnValue>
Promise<void> subscribe(const Fn<Returned(Next, Fn<void()>, Fn<void(Error)>)>& registration, OnValue onValue,
                        Opt<AbortSignal> signal = {}) {
  using Composition = detail::Composition<void>;

  return detail::compose<void>(signal, [&](const std::shared_ptr<Composition>& c) {
    auto next = detail::Handout<Next>::make([c, onValue](auto... value) {
      c->deliver([onValue, value = std::make_tuple(std::move(value)...)]() mutable {
        std::apply([&](auto&&... v) { onValue(std::forward<decltype(v)>(v)...); }, std::move(value));
      });
    });
    Fn<void()> end = [c] { c->succeed(undefined); };
    Fn<void(Error)> fail = [c](Error error) { c->fail(std::move(error)); };

    return detail::registerWith(registration, std::move(next), std::move(end), std::move(fail));
  });
}

}  // namespace lucent
