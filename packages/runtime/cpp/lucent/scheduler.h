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

#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace lucent {

class Scheduler {
 public:
  using Job = std::function<void()>;

  static Scheduler& instance();

  std::recursive_mutex& lock() { return lock_; }

  /// Runs `job` on the Lucent thread, holding the lock, then drains
  /// microtasks.
  void post(Job job);
  void postDelayed(double ms, Job job);
  /// Queues a promise continuation. Callers hold the lock.
  void enqueueMicrotask(Job job);
  /// Runs queued microtasks. Callers hold the lock.
  void drainMicrotasks();
  bool hasMicrotasks() const { return !microtasks_.empty(); }

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

  std::recursive_mutex lock_;
  std::mutex queueMutex_;
  std::condition_variable cv_;
  std::condition_variable idleCv_;
  std::deque<Job> jobs_;
  std::priority_queue<Timer, std::vector<Timer>, std::greater<Timer>> timers_;
  uint64_t timerSeq_ = 0;
  size_t running_ = 0;
  std::deque<Job> microtasks_;
  bool stopping_ = false;
  std::thread thread_;
  std::thread::id threadId_;
};

/// Entered for every call from JavaScript into Lucent code. Holds the Lucent
/// lock; on exit, hands pending microtasks to the Lucent thread.
class LucentScope {
 public:
  LucentScope() : guard_(Scheduler::instance().lock()) {}
  ~LucentScope();
  LucentScope(const LucentScope&) = delete;
  LucentScope& operator=(const LucentScope&) = delete;

 private:
  std::unique_lock<std::recursive_mutex> guard_;
};

}  // namespace lucent
