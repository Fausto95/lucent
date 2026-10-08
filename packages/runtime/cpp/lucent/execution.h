// Lucent runtime — execution contexts.
//
// An execution context is where Lucent code runs one piece at a time. Its
// executor (a thread, or the platform's main loop) runs turns in the order
// they were posted; each turn runs its job, then the context's own
// microtasks. Its root scope is the ancestor of every scope created for
// work that lives there. There are three kinds:
//
// - the legacy module context (Scheduler, scheduler.h): the Lucent thread,
//   also entered from any thread by taking the Lucent lock. Every module's
//   code runs there, serialized as it always was.
// - the main context: the platform's UI loop. It never takes the Lucent
//   lock, so it never waits behind module code.
// - isolated contexts, each with a thread of its own.
//
// A context never waits for another: work crosses between them as posted
// jobs that own what they carry.
#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

#include "report.h"
#include "scope.h"

namespace lucent {

using Job = std::function<void()>;

/// Process-unique and never reused; 0 is none.
using ContextId = uint32_t;

/// Runs `job` on the platform's main thread (main queue, main Looper; a
/// dedicated thread standing in for it on other hosts). Implemented per
/// platform: lucent/platform, and native.cpp for hosts.
void postToMain(std::function<void()> job);
bool onMainThread();

/// The stack each of Lucent's own threads gets (the Lucent thread, isolated
/// and compute contexts, the main context's clock): 8 MB, a macOS or Linux
/// main thread's, where a secondary thread's default is 512 KB on Apple
/// platforms and about 1 MB on Android. Only touched pages cost memory. Lucent code recurses on the native
/// stack, so its depth limit is this size divided by its frames' (see
/// docs/semantics.md, deep recursion).
inline constexpr size_t kThreadStackSize = 8 * 1024 * 1024;

/// A thread that runs posted jobs, and timers once due, one at a time in
/// order. The thread keeps this object alive until it ends. On Apple
/// platforms each job runs in an autorelease pool of its own, so what the
/// platform autoreleases during it is released when it ends rather than
/// never (a thread Lucent starts has no pool otherwise).
class WorkerThread : public std::enable_shared_from_this<WorkerThread> {
 public:
  /// How the thread runs a job (a context's turn).
  using Run = std::function<void(Job&)>;

  static std::shared_ptr<WorkerThread> start(Run run);

  WorkerThread(const WorkerThread&) = delete;
  WorkerThread& operator=(const WorkerThread&) = delete;

  /// Any thread. False once stopping: the job is dropped.
  bool post(Job job);
  bool postDelayed(double ms, Job job);

  bool isCurrent() const { return std::this_thread::get_id() == id_; }

  /// Jobs queued or running, and timers pending.
  size_t pendingWork();

  /// Blocks until no jobs or timers are pending, or the timeout elapses.
  /// For tests and tools: never call it from a context's thread.
  bool waitIdle(double timeoutMs);

  /// Takes no more work: runs `last` (directly, not through Run) after the
  /// job running now, destroys what is still queued on this thread, and
  /// ends it. Returns at once, without waiting for any of that.
  void stop(Job last = nullptr);

  /// Blocks until the thread has ended, or the timeout elapses (tests).
  bool waitStopped(double timeoutMs);

 private:
  explicit WorkerThread(Run run) : run_(std::move(run)) {}

  void loop();

  struct Timer {
    std::chrono::steady_clock::time_point at;
    uint64_t seq;
    Job job;

    bool operator>(const Timer& o) const { return at != o.at ? at > o.at : seq > o.seq; }
  };

  const Run run_;
  std::thread::id id_;

  std::mutex m_;
  std::condition_variable cv_;
  std::condition_variable idleCv_;
  std::condition_variable idCv_;
  bool started_ = false;
  std::deque<Job> jobs_;
  std::priority_queue<Timer, std::vector<Timer>, std::greater<Timer>> timers_;
  uint64_t timerSeq_ = 0;
  size_t running_ = 0;
  bool stopping_ = false;
  bool stopped_ = false;
  Job last_;
};

class ExecutionContext;

/// A context as an owner: null names the legacy module context, which owns
/// whatever no other context does.
using ContextRef = std::shared_ptr<ExecutionContext>;

/// Also the owner of its root scope and the scopes under it: their disposal
/// runs here.
class ExecutionContext : public Scope::Owner, public std::enable_shared_from_this<ExecutionContext> {
 public:
  ExecutionContext(const ExecutionContext&) = delete;
  ExecutionContext& operator=(const ExecutionContext&) = delete;
  virtual ~ExecutionContext() = default;

  /// The context the calling thread is in: the legacy module context while
  /// the thread holds the Lucent lock, else the one it entered (a turn, or
  /// a ContextEntry); null outside any.
  static ExecutionContext* current();

  /// current() as an owner reference (null for the legacy module context,
  /// and outside any context).
  static ContextRef currentRef();

  /// The legacy module context (Scheduler::instance()).
  static ExecutionContext& legacy();

  /// The context `ref` names.
  static ExecutionContext& of(const ContextRef& ref) { return ref ? *ref : legacy(); }

  /// The platform's UI loop (a stand-in thread on hosts without one).
  static ExecutionContext& main();

  ContextId id() const { return id_; }

  const std::shared_ptr<Scope>& root() const { return root_; }

  bool isCurrent() const override { return current() == this; }

  /// Whether the calling thread is the one this context's turns run on
  /// (the main thread, for the main context), entered or not.
  virtual bool onExecutor() const = 0;

  /// Any thread: runs `job` as a turn of this context. False if the
  /// context has stopped; the job is then destroyed on the calling thread.
  bool post(Job job) override;

  /// As post(), but the job is dropped, not run, if `owner` was disposed
  /// before its turn came (it is destroyed on this context).
  bool post(Job job, const std::shared_ptr<Scope>& owner);

  /// Any thread: runs `job` as a turn of this context after `ms`.
  bool postDelayed(double ms, Job job);

  /// Queues a microtask. Only on this context: throws std::logic_error
  /// elsewhere (post instead).
  void enqueueMicrotask(Job job);

  /// Runs queued microtasks, including those they queue. Only on this
  /// context.
  void drainMicrotasks();

  bool hasMicrotasks() const { return *pendingMicrotasks_ > 0; }

 protected:
  /// `microtaskCount` is where the context counts its microtasks, if not in
  /// itself: the legacy module context's is a static, which every call from
  /// JavaScript reads without reaching the instance.
  explicit ExecutionContext(size_t* microtaskCount = nullptr);

  /// Gives the context its root scope, owned by it. Called once, by the
  /// factory: the context must already be shared.
  void makeRoot() { root_ = Scope::createRoot(0, weak_from_this()); }

  /// Hands a turn to the executor; false if it has stopped.
  virtual bool dispatch(Job job) = 0;
  virtual bool dispatchDelayed(double ms, Job job) = 0;

  /// Runs `job` as a turn: entered, the job run and destroyed, then the
  /// microtasks.
  virtual void runTurn(Job& job);

 private:
  friend class ContextEntry;

  const ContextId id_;
  std::shared_ptr<Scope> root_;

  std::deque<Job> microtasks_;
  size_t ownMicrotasks_ = 0;
  size_t* const pendingMicrotasks_;
};

/// Enters a context other than the legacy module context (which is entered
/// with LucentScope) on the calling thread: for a platform callback that
/// needs an answer now. The thread must be the context's own (the main
/// thread for the main context), not holding the Lucent lock. Leaving the
/// outermost entry runs the context's microtasks.
class ContextEntry {
 public:
  explicit ContextEntry(ExecutionContext& context);
  ~ContextEntry();

  ContextEntry(const ContextEntry&) = delete;
  ContextEntry& operator=(const ContextEntry&) = delete;

 private:
  ExecutionContext& context_;
  ExecutionContext* previous_;
};

/// A context with a thread of its own, running until shutdown().
class IsolatedContext final : public ExecutionContext {
 public:
  static std::shared_ptr<IsolatedContext> create();

  /// Shuts down.
  ~IsolatedContext() override;

  /// Takes no more work, then, on its thread and after the turn running
  /// now: disposes the root scope and drops whatever is still queued.
  /// Returns at once.
  void shutdown();

  size_t pendingWork() { return worker_->pendingWork(); }

  /// For tests: see WorkerThread.
  bool waitIdle(double timeoutMs) { return worker_->waitIdle(timeoutMs); }
  bool waitStopped(double timeoutMs) { return worker_->waitStopped(timeoutMs); }

 private:
  IsolatedContext();

  bool dispatch(Job job) override;
  bool dispatchDelayed(double ms, Job job) override;
  bool onExecutor() const override { return worker_->isCurrent(); }

  std::shared_ptr<WorkerThread> worker_;
  std::atomic<bool> stopping_{false};
};

/// The scope module code's work belongs to (a compute task, say): the scope
/// of the JavaScript runtime its modules run for, so tearing that runtime
/// down (a reload) cancels the work; the legacy module context's root while
/// no runtime is attached. A torn-down runtime's scope stays the module
/// scope until another replaces it: nothing more starts for it. Any thread.
std::shared_ptr<Scope> moduleScope();

/// Makes `scope` the module scope (null: none); Host::create gives it the
/// new runtime's.
void setModuleScope(std::shared_ptr<Scope> scope);

/// The scope work started on `owner` belongs to: module code's (the legacy
/// module context, a null ref) the module scope, so a reload stops it;
/// another context's its root. Every promise-returning API that registers
/// work (operations, callbacks, timers, requests) starts it here.
std::shared_ptr<Scope> ownedScope(const ContextRef& owner);

namespace detail {
/// An Objective-C autorelease pool for the scope's lifetime on Apple
/// platforms (objc_autoreleasePoolPush/Pop, which C++ can call); nothing
/// elsewhere.
class AutoreleasePool {
 public:
#if defined(__APPLE__)
  AutoreleasePool();
  ~AutoreleasePool();
#else
  // User-provided, so a pool held for its scope is not an unused variable.
  AutoreleasePool() {}
  ~AutoreleasePool() {}
#endif
  AutoreleasePool(const AutoreleasePool&) = delete;
  AutoreleasePool& operator=(const AutoreleasePool&) = delete;

 private:
  [[maybe_unused]] void* pool_ = nullptr;
};

/// Runs `job`, reporting what it throws.
void runGuarded(Job& job, const char* where);

/// Runs `job` on the thread `on` runs on: here if that is this thread, or
/// `on` is null (what it throws reaches the caller); else as a turn there,
/// where what it throws is reported. Here too if `on` takes no more work.
void runOn(ExecutionContext* on, Job job);
}  // namespace detail

}  // namespace lucent
