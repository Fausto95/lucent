// Lucent runtime — native operations as promises.
//
// Native work that completes later, on any thread (a Kotlin coroutine, a
// platform callback), becomes a promise of the context that started it: an
// Operation (scope.h) under that context's root scope, whose outcome settles
// the promise there. Disposing the scope, or the AbortSignal the caller gave
// aborting, cancels it: the promise rejects at once, the registration's
// cleanup tells the native work to stop, and whatever it produces after that
// is released, never delivered.
#pragma once

#include <functional>
#include <memory>
#include <utility>

#include "abort.h"
#include "async.h"
#include "execution.h"
#include "scope.h"

namespace lucent {

/// Starts native work for the calling context: `registration` begins it and
/// returns what ends it (see Operation::start). Already aborted, the work
/// never starts.
template <class T>
Promise<T> nativeOperation(typename Operation<T>::Registration registration, Opt<AbortSignal> signal = {}) {
  ContextRef owner = ExecutionContext::currentRef();
  std::shared_ptr<Scope> scope = ExecutionContext::of(owner).root();
  AbortSignal abort = signal.has() ? signal.get() : nullptr;

  Opt<Error> abortedBy;
  if (abort && abort->aborted.load()) abortedBy = abort->reason;

  Promise<T> promise;
  auto operation = Operation<T>::start(scope, registration, abortedBy);

  // The signal holds a listener only while the operation is pending.
  if (abort && operation->state() == OperationState::Pending) {
    std::weak_ptr<Operation<T>> pending = operation;
    std::weak_ptr<AbortSignalObject> weak = abort;

    uint64_t id = abort->add([pending, weak] {
      auto op = pending.lock();
      auto s = weak.lock();
      if (op && s) op->cancel(s->reason);
    });

    operation->onSettled([weak, id](const typename Operation<T>::Outcome&) {
      if (auto s = weak.lock(); s && id) s->remove(id);
    });
  }

  operation->onSettled([promise](const typename Operation<T>::Outcome& outcome) {
    if (outcome.state == OperationState::Succeeded) {
      promise.resolve(*outcome.value);
    } else {
      promise.reject(outcome.error);
    }
  });

  return promise;
}

}  // namespace lucent
