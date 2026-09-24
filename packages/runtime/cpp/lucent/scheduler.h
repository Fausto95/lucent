// Lucent runtime — execution model.
//
// Lucent code runs one piece at a time, like JavaScript: every entry into
// Lucent code (a synchronous call from the JS thread, or a job on the Lucent
// thread) holds the Lucent lock. Async functions run on the Lucent thread and
// interleave only at `await`, so Lucent code never races with itself.
//
// Invariant: the Lucent thread never waits for the JS thread, so the JS
// thread may always block on the Lucent lock without deadlocking.
#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <exception>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace lucent {

/// The one place errors no Lucent code can catch are reported: thrown by a
/// job, or by a callback the platform made.
void reportUncaught(std::exception_ptr e, const char* where);
/// Logs an error where the platform shows an app's errors (logcat, the
/// unified log) and to stderr.
void logError(const char* message);

/// The Lucent lock: recursive, as a Lucent call may call back into
/// JavaScript that calls Lucent again. Every synchronous call from
/// JavaScript takes it, so the uncontended path is one compare-and-swap;
/// std::recursive_mutex (a pthread mutex) cost a third of a call. Waiters
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
    uint32_t c = kFree;
    if (!state_.compare_exchange_strong(c, kLocked, std::memory_order_acquire, std::memory_order_relaxed)) {
      if (c != kContended) c = state_.exchange(kContended, std::memory_order_acquire);
      while (c != kFree) {
        state_.wait(kContended, std::memory_order_relaxed);
        c = state_.exchange(kContended, std::memory_order_acquire);
      }
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
    uint32_t c = kFree;
    if (!state_.compare_exchange_strong(c, kLocked, std::memory_order_acquire, std::memory_order_relaxed)) return false;
    owner_.store(self, std::memory_order_relaxed);
    depth_ = 1;
    return true;
  }

  void unlock() {
    if (--depth_ > 0) return;
    owner_.store(std::thread::id(), std::memory_order_relaxed);
    if (state_.exchange(kFree, std::memory_order_release) == kContended) state_.notify_one();
  }

 private:
  static constexpr uint32_t kFree = 0, kLocked = 1, kContended = 2;
  std::atomic<uint32_t> state_{kFree};
  std::atomic<std::thread::id> owner_{};
  unsigned depth_ = 0;
};

class Scheduler {
 public:
  using Job = std::function<void()>;

  static Scheduler& instance() {
    // Leaked on purpose: jobs may still reference the scheduler during
    // static destruction at process exit.
    static Scheduler* s = new Scheduler();
    return *s;
  }

  /// Static, like the pending count: a call from JavaScript reaches both
  /// without the scheduler's function-local static.
  static LucentLock& lock() { return lock_; }

  /// Runs `job` on the Lucent thread, holding the lock, then drains
  /// microtasks.
  void post(Job job);
  void postDelayed(double ms, Job job);
  /// Queues a promise continuation. Callers hold the lock.
  void enqueueMicrotask(Job job);
  /// Runs queued microtasks. Callers hold the lock.
  void drainMicrotasks();
  static bool hasMicrotasks() { return pendingMicrotasks_ > 0; }

  bool onLucentThread() const { return std::this_thread::get_id() == threadId_; }
  /// Jobs queued or running, and timers pending (for tests and shutdown).
  size_t pendingWork();
  /// Blocks until no jobs or timers are pending, or the timeout elapses.
  bool waitIdle(double timeoutMs);

 private:
  Scheduler();
  ~Scheduler();
  void run();

  struct Timer {
    std::chrono::steady_clock::time_point at;
    uint64_t seq;
    Job job;
    bool operator>(const Timer& o) const { return at != o.at ? at > o.at : seq > o.seq; }
  };

  static inline LucentLock lock_;
  std::mutex queueMutex_;
  std::condition_variable cv_;
  std::condition_variable idleCv_;
  std::deque<Job> jobs_;
  std::priority_queue<Timer, std::vector<Timer>, std::greater<Timer>> timers_;
  uint64_t timerSeq_ = 0;
  size_t running_ = 0;
  std::deque<Job> microtasks_;
  static inline size_t pendingMicrotasks_ = 0;  // microtasks_.size(), under the lock
  bool stopping_ = false;
  std::thread thread_;
  std::thread::id threadId_;
};

/// Entered for every call from JavaScript into Lucent code. Holds the Lucent
/// lock; on exit, hands pending microtasks to the Lucent thread.
class LucentScope {
 public:
  LucentScope() : guard_(Scheduler::lock()) {}
  ~LucentScope() {
    if (Scheduler::hasMicrotasks()) handOffMicrotasks();
  }
  LucentScope(const LucentScope&) = delete;
  LucentScope& operator=(const LucentScope&) = delete;

 private:
  static void handOffMicrotasks();
  std::unique_lock<LucentLock> guard_;
};

}  // namespace lucent
