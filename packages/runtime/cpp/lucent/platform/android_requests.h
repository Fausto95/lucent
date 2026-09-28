// Lucent runtime — requests Android answers later: an activity result, a
// permission request. Each is an Operation under a scope, keyed by its id,
// which the platform side echoes back with the answer.
//
// The answer may come from any thread (Android's main thread): it settles
// the promise on the context that asked. A request cancelled first (its
// signal aborted, its scope disposed) is forgotten on the platform side,
// which drops the answer if it still comes: cancelling does not close a
// dialog the platform already shows. No JNI here, so the host tests run it.
#pragma once

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <utility>

#include "../abort.h"
#include "../async.h"
#include "../execution.h"
#include "../scope.h"

namespace lucent::jni {

template <class T>
class Requests {
 public:
  /// Tells the platform side to forget a request (cancelled before its answer).
  using Forget = std::function<void(OperationId)>;
  /// Sends a request to the platform side, under its id.
  using Launch = std::function<void(OperationId)>;

  explicit Requests(Forget forget) : forget_(std::move(forget)) {}

  Requests(const Requests&) = delete;
  Requests& operator=(const Requests&) = delete;

  /// Starts a request under `scope` and returns its promise, settled on the
  /// calling context. An aborted `signal` (now or later) or a disposed scope
  /// cancels it with an AbortError; `launch` throwing rejects it.
  Promise<T> start(const std::shared_ptr<Scope>& scope, Opt<AbortSignal> signal, const Launch& launch) {
    Promise<T> promise;
    AbortSignal aborts = signal.has() ? signal.get() : nullptr;

    Opt<Error> abortedBy;
    if (aborts && aborts->aborted.load()) abortedBy = aborts->reason;

    auto op = Operation<T>::start(
        scope,
        [&](const std::shared_ptr<Operation<T>>& started) -> std::function<void()> {
          OperationId id = started->token().operation;

          {
            std::lock_guard<std::mutex> g(m_);
            pending_.emplace(id, started);
          }

          launch(id);

          uint64_t listener = 0;
          if (aborts) {
            std::weak_ptr<Operation<T>> weak = started;
            std::weak_ptr<AbortSignalObject> from = aborts;
            listener = aborts->add([weak, from] {
              auto op = weak.lock();
              auto signal = from.lock();
              if (op && signal) op->cancel(signal->reason);
            });
          }

          // After the outcome: unlisten, and forget a request the platform did not answer.
          std::weak_ptr<Operation<T>> weak = started;
          return [this, id, aborts, listener, weak] {
            if (aborts && listener) aborts->remove(listener);

            bool answered;
            {
              std::lock_guard<std::mutex> g(m_);
              answered = pending_.erase(id) == 0;
            }

            auto op = weak.lock();
            if (!answered && op && op->state() == OperationState::Cancelled) forget_(id);
          };
        },
        abortedBy);

    // A launch that threw failed the operation; it never reached the platform.
    if (op->state() != OperationState::Pending) {
      std::lock_guard<std::mutex> g(m_);
      pending_.erase(op->token().operation);
    }

    op->onSettled([promise](const typename Operation<T>::Outcome& outcome) {
      if (outcome.state == OperationState::Succeeded) {
        promise.resolve(*outcome.value);
      } else {
        promise.reject(outcome.error);
      }
    });

    return promise;
  }

  /// The platform's answer: true if it settled a pending request, false
  /// for one already settled or cancelled (a late answer, dropped).
  bool deliver(OperationId id, ::lucent::detail::Stored<T> value) {
    auto op = take(id);
    return op && op->succeed(std::move(value));
  }

  /// The platform could not answer (no Activity, say).
  bool fail(OperationId id, Error error) {
    auto op = take(id);
    return op && op->fail(std::move(error));
  }

  /// Requests the platform has not answered.
  size_t pending() const {
    std::lock_guard<std::mutex> g(m_);
    return pending_.size();
  }

 private:
  std::shared_ptr<Operation<T>> take(OperationId id) {
    std::lock_guard<std::mutex> g(m_);
    auto it = pending_.find(id);
    if (it == pending_.end()) return nullptr;

    auto op = it->second.lock();
    pending_.erase(it);
    return op;
  }

  const Forget forget_;
  mutable std::mutex m_;
  std::map<OperationId, std::weak_ptr<Operation<T>>> pending_;
};

}  // namespace lucent::jni
