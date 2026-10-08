// Lucent runtime — isolated compute.
//
// `compute(entry, input)` runs a compiled function on a bounded pool of
// worker threads and returns a promise of its result to the calling
// context. The input is copied at submission (transport.h), so the task
// shares nothing mutable with its caller; the result is moved back, and the
// promise settles on the context that submitted it, whatever thread the task
// ran on. Workers never take the Lucent lock or wait for the UI loop, so a
// task neither waits behind module code nor holds it up.
//
// The pool is bounded twice: a fixed number of workers (one fewer than the
// cores, at least one), and a queue of tasks waiting for one (1024). A
// submission that finds the queue full is rejected at once with a
// QuotaExceededError: the caller never blocks.
//
// A task ends at the first of:
// - its result or error, posted to its owner (the promise's context) and
//   delivered unless its scope was disposed by then;
// - cancellation: its signal aborting, its scope being disposed, or the pool
//   shutting down. The promise rejects at once. A task still queued leaves
//   the queue; a running one is asked to stop, and stops at its next
//   safepoint (TaskContext::checkCancelled). Native code between safepoints
//   is not interrupted: the task runs until it returns, and what it returns
//   is released on the worker.
// Either way it settles exactly once (an Operation, scope.h), and whatever
// loses (a result after cancellation, a result for a disposed scope) is
// released, never delivered: on the worker, or on the owner if it had
// already been posted there. What must be released on a particular thread
// routes its own release (Resource, NativeRef).
#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <utility>
#include <vector>

#include "abort.h"
#include "async.h"
#include "execution.h"
#include "jserror.h"
#include "scope.h"
#include "trace.h"
#include "transport.h"

namespace lucent {

class ComputePool;

namespace detail {
class ComputeTask;
}

/// What a running task sees of itself. Only its worker uses it.
class TaskContext {
 public:
  TaskContext(const TaskContext&) = delete;
  TaskContext& operator=(const TaskContext&) = delete;

  /// Whether the task's owner no longer wants its result.
  bool cancelled() const noexcept { return cancelled_.load(std::memory_order_relaxed); }

  /// A safepoint: throws an AbortError if the task was cancelled. One
  /// relaxed load when it was not, cheap enough for a loop's back edge.
  void checkCancelled() const {
    if (cancelled()) [[unlikely]]
      throwCancelled();
  }

  /// The task running on this thread; null elsewhere.
  static TaskContext* current() noexcept;

  /// The task's own scope, under its worker's root: made on first use, and
  /// disposed on the worker when the task returns, before its result
  /// leaves.
  const std::shared_ptr<Scope>& scope();

 private:
  friend class ComputePool;
  friend class detail::ComputeTask;

  TaskContext() = default;

  [[noreturn]] static void throwCancelled();

  void cancel() { cancelled_.store(true, std::memory_order_relaxed); }

  /// Disposes the scope, if it was made.
  void end();

  std::atomic<bool> cancelled_{false};
  std::shared_ptr<Scope> scope_;
};

/// A compiled function a task runs: what the compiler emits for each
/// function passed to compute(). `run` takes the task's own copy of the
/// input.
template <class In, class Out>
struct TaskEntry {
  /// For timings and reports.
  const char* name;
  Out (*run)(In&&, TaskContext&);
};

/// How long one task spent where, when the pool reports timings.
struct TaskTiming {
  const char* entry = "";
  /// Succeeded or Failed once delivered; Cancelled if it never was.
  OperationState outcome = OperationState::Cancelled;
  bool started = false;
  /// Taking the pool's lock at submission.
  std::chrono::nanoseconds admitted{0};
  /// From submission until a worker started it.
  std::chrono::nanoseconds waited{0};
  /// Running on the worker.
  std::chrono::nanoseconds ran{0};
  /// From its end until its outcome settled on the owner.
  std::chrono::nanoseconds delivered{0};
};

/// Receives each task's timing once it ends, on the thread it ends on.
using TimingSink = std::function<void(const TaskTiming&)>;

/// A pool's counters since it was made.
struct ComputeStats {
  size_t workers = 0;
  size_t capacity = 0;
  /// Now: waiting, and handed to a worker.
  size_t queued = 0;
  size_t running = 0;
  /// High-water marks.
  size_t peakQueued = 0;
  size_t peakRunning = 0;

  uint64_t submitted = 0;
  /// Refused because the queue was full.
  uint64_t rejected = 0;
  /// Queued because every worker was busy.
  uint64_t saturated = 0;
  /// Handed to a worker.
  uint64_t started = 0;
  uint64_t finished = 0;
  /// Cancelled while queued.
  uint64_t cancelledQueued = 0;
  /// Finished, but the outcome was released instead of posted: the task
  /// was cancelled, or its owner had gone.
  uint64_t abandoned = 0;
};

/// The QuotaExceededError of a submission that found the queue full.
Error computeQueueFullError(size_t capacity);

/// The InvalidStateError of a submission to a pool that has shut down.
Error computePoolClosedError();

/// The AbortError of a task that was queued or running when its pool shut
/// down.
Error computePoolShutdownError();

namespace detail {

/// One submission, as the pool sees it whatever its types.
class ComputeTask : public std::enable_shared_from_this<ComputeTask> {
 public:
  using Time = std::chrono::steady_clock::time_point;

  ComputeTask(const ComputeTask&) = delete;
  ComputeTask& operator=(const ComputeTask&) = delete;

  /// Reports the timing, if the task was timed.
  virtual ~ComputeTask();

  /// On a worker: runs the entry, then posts the outcome to the owner, or
  /// releases it here if the task was cancelled (and returns false).
  virtual bool run() = 0;

  /// Settles the task as cancelled by `reason`, if it has not settled.
  virtual void abandon(const Error& reason) = 0;

 protected:
  explicit ComputeTask(const char* name) : name_(name) {}

  static Time now() { return std::chrono::steady_clock::now(); }

  bool timed() const { return sink_ != nullptr; }

  /// Records a delivered outcome (on the owner).
  void delivered(OperationState outcome);

  /// Ends the run: disposes the task's scope, notes the time, and counts
  /// the task finished (before its outcome is posted, so whoever sees the
  /// outcome sees the count).
  void finishRun();

  /// Tracing: ends the span of the phase `ended` and begins `next`'s (none:
  /// the task is done). Nothing unless the task was traced.
  void tracePhase(const char* ended, const char* next) noexcept;

  TaskContext context_;

 private:
  friend class lucent::ComputePool;

  const char* const name_;

  // Timing: written by the pool and the task in the order the task moves,
  // each handoff a lock or a post, so read without further locking.
  std::shared_ptr<const TimingSink> sink_;
  std::chrono::nanoseconds admitted_{0};
  Time submitted_{};
  Time started_{};
  Time finished_{};
  Time settled_{};
  std::atomic<OperationState> outcome_{OperationState::Cancelled};

  /// Tracing, when on at submission: the task's id and its phase's span,
  /// handed along with the task.
  uint64_t traceId_ = 0;
  trace::Mark phase_;

  /// Guarded by the pool's lock.
  enum class Place : uint8_t { None, Queued, Assigned } place_ = Place::None;

  /// The pool running it, while it runs (which keeps the pool alive).
  ComputePool* runningOn_ = nullptr;
};

template <class In, class Out>
class TypedTask final : public ComputeTask {
 public:
  using Value = Stored<Out>;

  TypedTask(const TaskEntry<In, Out>& entry, In&& input, ContextRef owner, const std::shared_ptr<Scope>& scope)
      : ComputeTask(entry.name), entry_(entry), input_(std::move(input)), owner_(std::move(owner)), scope_(scope) {}

  void bind(const std::shared_ptr<Operation<Out>>& operation) { operation_ = operation; }

  bool run() override {
    std::optional<Value> value;
    Error error;

    try {
      if constexpr (std::is_void_v<Out>) {
        entry_.run(std::move(*input_), context_);
        value.emplace(undefined);
      } else {
        value.emplace(entry_.run(std::move(*input_), context_));
      }
    } catch (...) {
      error = currentError(std::current_exception());
    }

    input_.reset();
    finishRun();

    // Nobody wants it: released here, on the worker.
    std::shared_ptr<Scope> scope = context_.cancelled() ? nullptr : scope_.lock();
    if (!scope) {
      tracePhase("compute.run", nullptr);
      return false;
    }

    auto self = std::static_pointer_cast<TypedTask>(shared_from_this());

    // Before the post: once posted, the owner may settle at once.
    tracePhase("compute.run", "compute.deliver");

    // Dropped with what it carries if the scope is disposed first: then
    // destroyed on the owner, or here if the owner takes no more work.
    bool posted = ExecutionContext::of(owner_).post(
        [self, value = std::move(value), error = std::move(error)]() mutable { self->settle(std::move(value), std::move(error)); },
        scope);

    if (!posted) tracePhase("compute.deliver", nullptr);

    return posted;
  }

  void abandon(const Error& reason) override {
    if (auto operation = operation_.lock()) operation->cancel(reason);
  }

 private:
  /// On the owner. Loses to a cancellation that came first: the value is
  /// then released here.
  void settle(std::optional<Value>&& value, Error&& error) {
    auto operation = operation_.lock();
    if (!operation) return;

    if (error) {
      operation->fail(std::move(error));
    } else if constexpr (std::is_void_v<Out>) {
      operation->succeed();
    } else {
      operation->succeed(std::move(*value));
    }

    delivered(operation->state());
    tracePhase("compute.deliver", nullptr);
  }

  const TaskEntry<In, Out> entry_;
  std::optional<In> input_;
  const ContextRef owner_;
  const std::weak_ptr<Scope> scope_;
  std::weak_ptr<Operation<Out>> operation_;
};

}  // namespace detail

struct ComputePoolOptions {
  /// 0: one fewer than the cores, at least one.
  size_t workers = 0;
  /// Tasks that may wait for a worker; 0: ComputePool::kDefaultCapacity.
  size_t capacity = 0;
};

/// A bounded set of worker threads, each an isolated execution context, and
/// the queue of tasks waiting for one.
class ComputePool : public std::enable_shared_from_this<ComputePool> {
 public:
  static constexpr size_t kDefaultCapacity = 1024;

  using Options = ComputePoolOptions;

  static std::shared_ptr<ComputePool> create(Options options = {});

  /// The process's pool, made on first use; it lives as long as the process.
  static const std::shared_ptr<ComputePool>& shared();

  /// Shuts down.
  ~ComputePool();

  ComputePool(const ComputePool&) = delete;
  ComputePool& operator=(const ComputePool&) = delete;

  size_t workers() const { return workers_.size(); }

  size_t capacity() const { return capacity_; }

  /// Any thread, idempotent, returns at once: refuses new tasks
  /// (InvalidStateError), cancels those queued or running
  /// (computePoolShutdownError), and stops the workers once their running
  /// tasks return.
  void shutdown();

  /// For tests: blocks until every worker has stopped, or the timeout
  /// elapses. Never call it from a worker.
  bool waitStopped(double timeoutMs);

  ComputeStats stats() const;

  /// Reports each task submitted from now on, when it ends; null stops.
  /// Off by default: untimed tasks read no clock.
  void setTimingSink(TimingSink sink);

  /// Queues `task` (or hands it to an idle worker), and follows `signal`.
  /// Throws the submission's failure: a full queue, or a closed pool.
  /// Returns the operation's cleanup: whatever settled the task, the pool
  /// stops it and forgets it.
  std::function<void()> admit(const std::shared_ptr<detail::ComputeTask>& task, const AbortSignal& signal);

 private:
  // Counts a task finished as its run ends (finishRun).
  friend class detail::ComputeTask;

  explicit ComputePool(Options options);

  using TaskRef = std::shared_ptr<detail::ComputeTask>;

  /// Posts `task` as a turn of worker `index`.
  void dispatch(size_t index, TaskRef task);

  /// On worker `index`: runs `task`, then takes the next one, if any.
  void runOn(size_t index, TaskRef task);

  /// Takes `task` out of the queue if it is still there.
  void withdraw(const TaskRef& task);

  std::vector<std::shared_ptr<IsolatedContext>> workers_;
  const size_t capacity_;

  std::atomic<bool> timing_{false};

  mutable std::mutex m_;
  bool closed_ = false;
  std::vector<size_t> idle_;
  std::deque<TaskRef> queue_;
  /// Handed to a worker: running, or posted to it.
  std::vector<TaskRef> assigned_;
  std::shared_ptr<const TimingSink> sink_;
  ComputeStats stats_;
};

struct ComputeOptions {
  /// Aborting it cancels the task.
  Opt<AbortSignal> signal;
  /// What the task belongs to: disposing it cancels the task. Default: the
  /// calling context's (ownedScope).
  std::shared_ptr<Scope> scope;
  /// Default: ComputePool::shared().
  std::shared_ptr<ComputePool> pool;
};

/// Submits `owned`, an input only the task holds (already copied, or moved
/// to it), and returns the promise of the result, settled on the calling
/// context. Failures reject the promise: a full queue, a closed pool, an
/// aborted signal or an inactive scope.
template <class In, class Out>
Promise<Out> submit(const TaskEntry<In, Out>& entry, In&& owned, ComputeOptions options = {}) {
  std::shared_ptr<ComputePool> pool = options.pool ? std::move(options.pool) : ComputePool::shared();
  ContextRef owner = ExecutionContext::currentRef();
  std::shared_ptr<Scope> scope = options.scope ? std::move(options.scope) : ownedScope(owner);
  AbortSignal signal = options.signal.has() ? options.signal.get() : nullptr;

  Promise<Out> promise;
  auto task = std::make_shared<detail::TypedTask<In, Out>>(entry, std::move(owned), owner, scope);

  Opt<Error> abortedBy;
  if (signal && signal->aborted.load()) abortedBy = signal->reason;

  auto operation = Operation<Out>::start(
      scope,
      [&](const std::shared_ptr<Operation<Out>>& op) {
        task->bind(op);
        return pool->admit(task, signal);
      },
      abortedBy);

  operation->onSettled([promise](const typename Operation<Out>::Outcome& outcome) {
    if (outcome.state == OperationState::Succeeded) {
      promise.resolve(*outcome.value);
    } else {
      promise.reject(outcome.error);
    }
  });

  return promise;
}

/// `compute(entry, input)`: copies `input` (a snapshot: later changes by the
/// caller do not reach the task) and submits it. A copy refused
/// (DataCloneError) rejects the promise; nothing is submitted.
template <class In, class Out>
Promise<Out> compute(const TaskEntry<In, Out>& entry, const In& input, ComputeOptions options = {}) {
  static_assert(Transportable<In>, "A compute task's input must cross to it: every part needs a lucent::Transport");

  std::optional<In> owned;
  try {
    owned.emplace(transportCopy(input));
  } catch (...) {
    return Promise<Out>::rejected(currentError(std::current_exception()));
  }

  return submit(entry, std::move(*owned), std::move(options));
}

}  // namespace lucent
