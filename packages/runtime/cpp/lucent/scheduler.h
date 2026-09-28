// Lucent runtime — the legacy module context.
//
// Module code runs one piece at a time, like JavaScript: every entry into it
// (a synchronous call from the JS thread, or a job on the Lucent thread)
// holds the Lucent lock. Async functions run on the Lucent thread and
// interleave only at `await`, so module code never races with itself.
//
// Invariant: code holding the Lucent lock never waits for another thread,
// so any thread may block on the lock without deadlocking. The main context
// and isolated contexts (execution.h) never take it.
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>

#include "execution.h"
#include "report.h"
#include "trace.h"

namespace lucent {

/// The Lucent lock: recursive, as a Lucent call may call back into
/// JavaScript that calls Lucent again. Every synchronous call from
/// JavaScript takes it, so the uncontended path is one atomic increment
/// and a load; std::recursive_mutex (a pthread mutex) cost a third of a
/// call.
///
/// It is fair: a ticket lock, serving threads in the order they asked. A
/// thread that releases it and asks again (the Lucent thread between the
/// turns of a loop that yields) queues behind the threads already waiting,
/// so a waiter gets in within one turn per thread ahead of it. Waiters
/// block in atomic::wait (a futex, or __ulock on Apple platforms).
class LucentLock {
 public:
  void lock() {
    std::thread::id self = std::this_thread::get_id();

    // Only this thread stores its own id, so a relaxed read that sees it is
    // exact; any other value means another owner or none.
    if (owner_.load(std::memory_order_relaxed) == self) {
      depth_++;
      return;
    }

    // Sequentially consistent, with unlock(): either it sees this ticket
    // and wakes the waiters, or this thread sees the ticket it serves.
    const uint32_t ticket = next_.fetch_add(1, std::memory_order_seq_cst);

    uint32_t serving = serving_.load(std::memory_order_seq_cst);
    while (serving != ticket) {
      serving_.wait(serving, std::memory_order_relaxed);
      serving = serving_.load(std::memory_order_seq_cst);
    }

    owner_.store(self, std::memory_order_relaxed);
    depth_ = 1;
  }

  bool try_lock() {
    std::thread::id self = std::this_thread::get_id();

    if (owner_.load(std::memory_order_relaxed) == self) {
      depth_++;
      return true;
    }

    // Free is no ticket handed out beyond the one served: take that one.
    uint32_t serving = serving_.load(std::memory_order_seq_cst);
    uint32_t expected = serving;
    if (!next_.compare_exchange_strong(expected, serving + 1, std::memory_order_seq_cst, std::memory_order_relaxed)) {
      return false;
    }

    owner_.store(self, std::memory_order_relaxed);
    depth_ = 1;
    return true;
  }

  /// Whether the calling thread holds the lock.
  bool heldByCurrentThread() const { return owner_.load(std::memory_order_relaxed) == std::this_thread::get_id(); }

  void unlock() {
    if (--depth_ > 0) return;

    owner_.store(std::thread::id(), std::memory_order_relaxed);

    // Only the owner moves `serving_`, so it may read it relaxed.
    const uint32_t next = serving_.load(std::memory_order_relaxed) + 1;
    serving_.store(next, std::memory_order_seq_cst);

    // A ticket beyond the one now served: someone waits. Every waiter
    // wakes, and the one holding `next` goes in.
    if (next_.load(std::memory_order_seq_cst) != next) serving_.notify_all();
  }

 private:
  /// The next ticket to hand out, and the one that holds the lock (or may
  /// take it). Equal: free.
  std::atomic<uint32_t> next_{0};
  std::atomic<uint32_t> serving_{0};

  std::atomic<std::thread::id> owner_{};
  unsigned depth_ = 0;
};

/// The legacy module context: every module's code, serialized by the Lucent
/// lock. Its turns run on the Lucent thread; synchronous calls from other
/// threads (JavaScript's, or a platform callback's) enter it by taking the
/// lock, which is what makes it current (ExecutionContext::current).
class Scheduler final : public ExecutionContext {
 public:
  static Scheduler& instance();

  /// Static, like microtasksPending(): a call from JavaScript reaches both
  /// without the scheduler's function-local static.
  static LucentLock& lock() { return lock_; }

  /// Whether microtasks are queued here. Callers hold the lock.
  static bool microtasksPending() { return microtaskCount_ > 0; }

  bool onLucentThread() const { return worker_->isCurrent(); }

  /// Jobs queued or running, and timers pending (for tests and shutdown).
  size_t pendingWork() { return worker_->pendingWork(); }

  /// Blocks until no jobs or timers are pending, or the timeout elapses.
  bool waitIdle(double timeoutMs) { return worker_->waitIdle(timeoutMs); }

 private:
  Scheduler();

  bool dispatch(Job job) override { return worker_->post(std::move(job)); }
  bool dispatchDelayed(double ms, Job job) override { return worker_->postDelayed(ms, std::move(job)); }
  bool onExecutor() const override { return worker_->isCurrent(); }

  /// Holds the lock for the job and the microtasks after it.
  void runTurn(Job& job) override;

  static inline LucentLock lock_;
  /// Guarded by the lock.
  static inline size_t microtaskCount_ = 0;
  std::shared_ptr<WorkerThread> worker_;
};

/// Entered for every call from JavaScript into Lucent code, and by platform
/// callbacks into module code (callNow): enters the legacy module context
/// by holding the Lucent lock. On exit off the Lucent thread, hands pending
/// microtasks to it; on the Lucent thread, the enclosing turn runs them once
/// its stack is empty.
class LucentScope {
 public:
  LucentScope() {
    if (trace::enabled()) [[unlikely]] {
      lockTraced(Scheduler::lock());
    } else {
      Scheduler::lock().lock();
    }
  }

  ~LucentScope() {
    if (Scheduler::microtasksPending()) handOffMicrotasks();

    Scheduler::lock().unlock();
  }

  LucentScope(const LucentScope&) = delete;
  LucentScope& operator=(const LucentScope&) = delete;

  /// Takes `lock`, recording the wait as a span (a call's, or a turn's).
  static void lockTraced(LucentLock& lock);

 private:
  static void handOffMicrotasks();
};

}  // namespace lucent
