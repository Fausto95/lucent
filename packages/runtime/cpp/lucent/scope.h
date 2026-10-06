// Lucent runtime — lifetime scopes and one-shot operations.
//
// A Scope owns work that must end when its owner does (a module instance,
// a view mount, a subscription, a task): child scopes, pending operations
// and cleanups. Disposing it ends all of them, deterministically and once.
//
// An Operation is one pending native request under a scope: it settles
// exactly once, from any thread, and whatever loses the race is released,
// never delivered. Its token names it without a pointer, so a late native
// callback can be checked against the scope's current state.
//
// Neither knows about JavaScript, the scheduler or the Lucent lock: callbacks
// run on the thread that settles or disposes, except that a scope with an
// owner (Scope::Owner, an execution context) is disposed there.
#pragma once

#include <atomic>
#include <cstdint>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <type_traits>
#include <utility>
#include <vector>

#include "core.h"
#include "jserror.h"
#include "live.h"

namespace lucent {

/// 0: no JS runtime (headless or native-only work).
using RuntimeId = uint32_t;
/// Process-unique and never reused; 0 is none.
using ScopeId = uint64_t;
/// Per scope; changes when the scope is disposed.
using Generation = uint32_t;
/// Process-unique and never reused; 0 is none.
using OperationId = uint64_t;

/// Valid only while all four fields match a live scope and the operation is
/// still pending there (Scope::validates).
struct OperationToken {
  RuntimeId runtime = 0;
  ScopeId scope = 0;
  Generation generation = 0;
  OperationId operation = 0;

  friend bool operator==(const OperationToken&, const OperationToken&) = default;
};

enum class OperationState : uint8_t { Pending, Succeeded, Failed, Cancelled };

/// The AbortError a disposing scope cancels its pending operations with.
Error scopeDisposedError();

class Scope;

namespace detail {

/// Aggregates like `using`: `next`, thrown while `pending` was, becomes a
/// SuppressedError of both. Either may be null.
std::exception_ptr aggregateErrors(std::exception_ptr pending, std::exception_ptr next);

/// The part of an operation its scope uses, whatever the value type.
class OperationBase : public std::enable_shared_from_this<OperationBase> {
 public:
  OperationBase(const OperationBase&) = delete;
  OperationBase& operator=(const OperationBase&) = delete;
  virtual ~OperationBase() = default;

  const OperationToken& token() const { return token_; }

  OperationState state() const { return state_.load(std::memory_order_acquire); }

  /// Outcomes that arrived after settlement and were dropped: repeated or
  /// racing native callbacks.
  uint64_t lateOutcomes() const { return late_.load(std::memory_order_relaxed); }

  /// The registration's cleanup (unregistering the native listener, say).
  /// It runs once, after settlement: then, or now if the operation already
  /// settled (it completed during registration). An empty function removes
  /// a cleanup that has not run; setting a second one is a caller bug.
  void setCleanup(std::function<void()> cleanup);

 protected:
  OperationBase() = default;

  /// Takes a token from `scope`, and joins its pending operations if
  /// `pending` and the scope is active; false otherwise.
  bool attach(const std::shared_ptr<Scope>& scope, bool pending);

  /// Leaves the scope's pending operations, once settled.
  void detach();

  /// Runs the cleanup if the operation settled and it has not run.
  std::exception_ptr runCleanup();

  void countLate() { late_.fetch_add(1, std::memory_order_relaxed); }

  /// Reports what an operation's callback threw (reportUncaught).
  static void report(std::exception_ptr e);

  /// Cancels for Scope::dispose, which runs the cleanups afterwards. Returns
  /// what the listeners threw.
  virtual std::exception_ptr cancelOwned(const Error& reason) = 0;

  /// Guards the state transition and every callback slot.
  mutable std::mutex m_;
  std::atomic<OperationState> state_{OperationState::Pending};

 private:
  friend class lucent::Scope;

  OperationToken token_;
  std::weak_ptr<Scope> scope_;
  std::function<void()> cleanup_;
  std::atomic<uint64_t> late_{0};
  [[no_unique_address]] live::Counted<live::Kind::Operation> counted_;
};

}  // namespace detail

/// States only move forward: active, disposing, disposed.
///
/// Every method is safe from any thread. A scope may have an owner, the
/// execution context its work belongs to: then dispose() from any other
/// thread, and the last reference dropped there, post the disposal to the
/// owner and return at once. Otherwise, or once the owner takes no more
/// work, cleanups run on the thread that disposes. A dispose() that finds
/// the scope already disposing (reentrant, or on another thread) returns at
/// once without waiting for it.
class Scope : public std::enable_shared_from_this<Scope> {
 public:
  enum class State : uint8_t { Active, Disposing, Disposed };
  using CleanupId = uint64_t;

  /// Where a scope's disposal runs: an execution context (execution.h).
  class Owner {
   public:
    virtual bool isCurrent() const = 0;

    /// Runs `job` there later; false if it takes no more work.
    virtual bool post(std::function<void()> job) = 0;

   protected:
    ~Owner() = default;
  };

  /// A child has its parent's owner and belongs to its parent's runtime:
  /// under a parent with a runtime, another `runtime` (0 included) throws
  /// std::invalid_argument. A child of an inactive parent is created
  /// disposed.
  static std::shared_ptr<Scope> create(RuntimeId runtime, const std::shared_ptr<Scope>& parent = nullptr);

  /// A scope without a parent, owned by `owner`.
  static std::shared_ptr<Scope> createRoot(RuntimeId runtime, std::weak_ptr<Owner> owner);

  /// The last reference to an active scope disposes it; errors go to
  /// reportUncaught.
  ~Scope();

  Scope(const Scope&) = delete;
  Scope& operator=(const Scope&) = delete;

  ScopeId id() const { return id_; }

  RuntimeId runtime() const { return runtime_; }

  Generation generation() const { return generation_.load(std::memory_order_acquire); }

  State state() const { return state_.load(std::memory_order_acquire); }

  /// Registers a cleanup. If the scope is not active, runs it now, on the
  /// calling thread (its error reaches the caller), and returns 0.
  CleanupId onDispose(std::function<void()> cleanup);

  /// Removes a cleanup that has not run; false if it ran, was removed, or
  /// disposal has begun.
  bool remove(CleanupId id);

  /// Idempotent. Changes the generation (invalidating tokens) and rejects
  /// new registrations, then disposes the children (most recently created
  /// first), cancels the pending operations (most recent first) and runs
  /// their cleanups, then runs this scope's cleanups in reverse order.
  /// Everything runs even if something throws; the errors come back
  /// aggregated like `using`: the last one, with the earlier ones as
  /// SuppressedError. Posted to the owner, the scope stays active until the
  /// disposal runs there, and its errors go to reportUncaught.
  std::exception_ptr dispose();

  bool validates(const OperationToken& token) const;

  /// What the scope holds now: live children, pending operations and
  /// cleanups not yet run (for debug ownership reports).
  size_t registrations() const;

 private:
  friend class detail::OperationBase;

  Scope(RuntimeId runtime, const std::shared_ptr<Scope>& parent, std::weak_ptr<Owner> owner);

  [[no_unique_address]] live::Counted<live::Kind::Scope> counted_;

  /// What disposal runs once the scope has stopped taking registrations.
  struct Teardown {
    std::map<ScopeId, std::shared_ptr<Scope>> children;
    std::map<OperationId, std::shared_ptr<detail::OperationBase>> operations;
    std::map<CleanupId, std::function<void()>> cleanups;
  };

  /// Moves the scope to disposing and takes its teardown; empty if it was
  /// not active.
  std::optional<Teardown> begin();

  static std::exception_ptr finish(Teardown& teardown);

  /// Disposes on the calling thread.
  std::exception_ptr disposeHere();

  bool adopt(const std::shared_ptr<detail::OperationBase>& op, bool pending);
  void forget(OperationId id);
  bool adoptChild(const std::shared_ptr<Scope>& child);
  void forgetChild(ScopeId id);

  const RuntimeId runtime_;
  const ScopeId id_;
  const std::weak_ptr<Scope> parent_;
  const std::weak_ptr<Owner> owner_;

  std::atomic<Generation> generation_{1};
  std::atomic<State> state_{State::Active};

  /// Guards the containers below. Never held while user code runs or while
  /// a user callback is destroyed.
  mutable std::mutex m_;
  CleanupId nextCleanup_ = 1;
  // Keyed by id, so iteration order is registration or creation order.
  std::map<CleanupId, std::function<void()>> cleanups_;
  std::map<ScopeId, std::shared_ptr<Scope>> children_;
  std::map<OperationId, std::shared_ptr<detail::OperationBase>> operations_;
};

/// One pending request with exactly one outcome: a value (none for void),
/// an error, or a cancellation. Settle it from any thread; only the first
/// call wins. Errors thrown by its listeners and cleanup are reported with
/// reportUncaught, except during Scope::dispose, which returns them.
template <class T>
class Operation final : public detail::OperationBase {
 public:
  using Value = std::conditional_t<std::is_void_v<T>, Undefined, T>;

  struct Outcome {
    OperationState state = OperationState::Pending;
    /// Set when Succeeded.
    std::optional<Value> value;
    /// Set when Failed or Cancelled.
    Error error;
  };

  using Listener = std::function<void(const Outcome&)>;

  /// Begins the native work and returns the cleanup that ends it (or an
  /// empty function). It may settle the operation before returning.
  using Registration = std::function<std::function<void()>(const std::shared_ptr<Operation>&)>;

  /// Pending under `scope`; Cancelled if the scope is not active.
  static std::shared_ptr<Operation> start(const std::shared_ptr<Scope>& scope) { return create(scope, nullptr); }

  /// Starts an operation and runs `registration`. Already aborted (an
  /// aborted signal gives `abortedBy`) or under an inactive scope, the
  /// operation starts Cancelled and registration is not called. If
  /// registration throws, the operation fails with that error.
  static std::shared_ptr<Operation> start(const std::shared_ptr<Scope>& scope, const Registration& registration,
                                          Opt<Error> abortedBy = {}) {
    if (!registration) throw std::invalid_argument("An operation's registration must be a function");

    auto op = create(scope, abortedBy.has() ? abortedBy.get() : nullptr);

    if (op->state() != OperationState::Pending) return op;

    std::function<void()> cleanup;
    try {
      cleanup = registration(op);
    } catch (...) {
      op->fail(currentError(std::current_exception()));
      return op;
    }

    if (cleanup) op->setCleanup(std::move(cleanup));

    return op;
  }

  /// True only for the call that settles the operation.
  bool succeed(Value value)
    requires(!std::is_void_v<T>)
  {
    return complete(OperationState::Succeeded, std::optional<Value>(std::move(value)), nullptr);
  }

  bool succeed()
    requires std::is_void_v<T>
  {
    return complete(OperationState::Succeeded, std::optional<Value>(Value{}), nullptr);
  }

  bool fail(Error error) { return complete(OperationState::Failed, std::nullopt, std::move(error)); }

  bool cancel(Error reason) { return complete(OperationState::Cancelled, std::nullopt, std::move(reason)); }

  /// Runs `listener` once with the outcome: at settlement, on the settling
  /// thread, or now if already settled. Listeners run in the order added.
  void onSettled(Listener listener) {
    if (!listener) throw std::invalid_argument("An operation listener must be a function");

    {
      std::lock_guard<std::mutex> g(m_);

      if (state_.load(std::memory_order_relaxed) == OperationState::Pending) {
        listeners_.push_back(std::move(listener));
        return;
      }
    }

    try {
      listener(outcome_);
    } catch (...) {
      report(std::current_exception());
    }
  }

  /// Receives the value of a success that lost (to a cancellation, say), so
  /// its resources are released rather than delivered. Without a hook it is
  /// destroyed. Runs on the losing caller's thread.
  void onLateOutcome(std::function<void(Value&&)> release)
    requires(!std::is_void_v<T>)
  {
    std::lock_guard<std::mutex> g(m_);

    std::swap(lateRelease_, release);
  }

 private:
  Operation() = default;

  static std::shared_ptr<Operation> create(const std::shared_ptr<Scope>& scope, Error cancelledBy) {
    if (!scope) throw std::invalid_argument("An operation needs a scope");

    std::shared_ptr<Operation> op(new Operation());

    if (!op->attach(scope, cancelledBy == nullptr)) {
      std::optional<Value> none;
      Error reason = cancelledBy ? std::move(cancelledBy) : scopeDisposedError();
      std::vector<Listener> nobody;

      op->transition(OperationState::Cancelled, none, reason, nobody);
    }

    return op;
  }

  /// The winning transition records the outcome and takes the listeners;
  /// false if already settled.
  bool transition(OperationState to, std::optional<Value>& value, Error& error, std::vector<Listener>& listeners) {
    if (state_.load(std::memory_order_acquire) != OperationState::Pending) return false;

    std::lock_guard<std::mutex> g(m_);

    OperationState expected = OperationState::Pending;
    if (!state_.compare_exchange_strong(expected, to, std::memory_order_acq_rel)) return false;

    outcome_.state = to;
    outcome_.value = std::move(value);
    outcome_.error = std::move(error);
    listeners.swap(listeners_);
    return true;
  }

  /// A settlement by a caller. A loser is counted and its value released.
  bool complete(OperationState to, std::optional<Value> value, Error error) {
    // Leaving the scope may drop its reference, the last but this one.
    auto self = shared_from_this();
    std::vector<Listener> listeners;

    if (!transition(to, value, error, listeners)) {
      countLate();
      releaseLate(std::move(value));
      return false;
    }

    detach();

    for (auto& listener : listeners) {
      try {
        listener(outcome_);
      } catch (...) {
        report(std::current_exception());
      }
    }

    report(runCleanup());

    return true;
  }

  std::exception_ptr cancelOwned(const Error& reason) override {
    std::optional<Value> none;
    Error error = reason;
    std::vector<Listener> listeners;

    if (!transition(OperationState::Cancelled, none, error, listeners)) return nullptr;

    std::exception_ptr errors;
    for (auto& listener : listeners) {
      try {
        listener(outcome_);
      } catch (...) {
        errors = detail::aggregateErrors(errors, std::current_exception());
      }
    }

    return errors;
  }

  void releaseLate(std::optional<Value>&& value) {
    if constexpr (!std::is_void_v<T>) {
      if (!value) return;

      std::function<void(Value&&)> release;
      {
        std::lock_guard<std::mutex> g(m_);
        release = lateRelease_;
      }

      if (!release) return;

      try {
        release(std::move(*value));
      } catch (...) {
        report(std::current_exception());
      }
    }
  }

  /// Written once, by the winning transition under m_; read-only after.
  Outcome outcome_;
  std::vector<Listener> listeners_;
  std::function<void(Value&&)> lateRelease_;
};

}  // namespace lucent
