// Lucent runtime — module actors.
//
// Module code runs one piece at a time per actor, like JavaScript: every
// entry into a module (a synchronous call from the JS thread, a job on its
// actor's thread, a platform callback) holds its actor's lock. Async
// functions run on the actor's thread and interleave only at `await`, so a
// module never races with itself.
//
// An actor is the modules that share objects: the compiler gives each set
// of modules that import one another (an import component: a package, or
// an app's own modules) an actor of its own (lucent_app::actor_N), with its
// own lock and thread, so a long job in one delays neither another nor the
// main thread. Code no actor was given (tests, hand-written glue) runs on
// the shared actor (Actor::shared()).
//
// What keeps every wait finite (docs/semantics.md, Concurrency model):
// - Code holding an actor's lock never waits for another thread, except
//   for another actor's lock: a JavaScript callback calling into another
//   package, or the platform calling one back during a native call.
// - Such a nested wait never closes a cycle: a thread whose wait would
//   (the actor it wants is held by a thread waiting, through any chain, for
//   an actor it holds) throws an Error instead of waiting.
// - The main thread never takes a ticket, so it never queues behind module
//   jobs. What it can defer runs once the actor is free (enterFromMain);
//   what must answer now (a delegate's result) waits only for the holder in
//   place, ahead of every queued entry, and a debug build warns past
//   mainWaitWarningMs(). A synchronous JavaScript callback lends its
//   thread's actors to the main thread while it runs (ParkedActors), so a
//   JS thread waiting for the main thread inside one never deadlocks it.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "execution.h"
#include "report.h"
#include "trace.h"

namespace lucent {

/// An actor's lock: recursive, as a Lucent call may call back into
/// JavaScript that calls Lucent again. Every synchronous call from
/// JavaScript takes it, so the uncontended path is one atomic increment
/// and a load; std::recursive_mutex (a pthread mutex) cost a third of a
/// call.
///
/// It is fair: a ticket lock, serving threads in the order they asked. A
/// thread that releases it and asks again (an actor's thread between the
/// turns of a loop that yields) queues behind the threads already waiting,
/// so a waiter gets in within one turn per thread ahead of it. Waiters
/// block in atomic::wait (a futex, or __ulock on Apple platforms).
///
/// The main thread enters without a ticket (lockFromMain, tryLockFromMain):
/// an owner that leaves while it waits hands it the lock, ahead of queued
/// tickets, and it may borrow the lock from an owner that lent it (park).
class LucentLock {
 public:
  LucentLock() = default;
  LucentLock(const LucentLock&) = delete;
  LucentLock& operator=(const LucentLock&) = delete;

  /// Throws an Error, not waiting, if the wait would close a cycle.
  void lock() {
    std::thread::id self = std::this_thread::get_id();

    // Only this thread stores its own id, so a relaxed read that sees it is
    // exact; any other value means another owner or none.
    if (owner_.load(std::memory_order_relaxed) == self) {
      if (lent_.load(std::memory_order_relaxed) != kKept) [[unlikely]]
        reclaim();
      depth_++;
      return;
    }

    if (borrower_.load(std::memory_order_relaxed) == self) [[unlikely]] {
      borrowDepth_++;
      return;
    }

    lockSlow(self);
  }

  bool try_lock() {
    std::thread::id self = std::this_thread::get_id();

    if (owner_.load(std::memory_order_relaxed) == self) {
      if (lent_.load(std::memory_order_relaxed) != kKept) reclaim();
      depth_++;
      return true;
    }

    if (borrower_.load(std::memory_order_relaxed) == self) {
      borrowDepth_++;
      return true;
    }

    return takeIfFree(self);
  }

  /// Whether the calling thread holds the lock (or has borrowed it).
  bool heldByCurrentThread() const {
    std::thread::id self = std::this_thread::get_id();
    return owner_.load(std::memory_order_relaxed) == self || borrower_.load(std::memory_order_relaxed) == self;
  }

  void unlock() {
    if (borrower_.load(std::memory_order_relaxed) == std::this_thread::get_id()) [[unlikely]] {
      giveBack();
      return;
    }

    if (--depth_ > 0) {
      // Back in the JavaScript callback that lent it.
      if (depth_ == parkedDepth_) [[unlikely]]
        lend();
      return;
    }

    owner_.store(std::thread::id(), std::memory_order_relaxed);

    // The main thread waits: it goes next, ahead of queued tickets, taking
    // over the ticket served now (its unlock serves the next).
    if (mainWaiting_.load(std::memory_order_seq_cst) != 0) [[unlikely]] {
      handToMain();
      return;
    }

    // Only the owner moves `serving_`, so it may read it relaxed.
    const uint32_t next = serving_.load(std::memory_order_relaxed) + 1;
    serving_.store(next, std::memory_order_seq_cst);

    // A ticket beyond the one now served: someone waits. Every waiter
    // wakes, and the one holding `next` goes in.
    if (next_.load(std::memory_order_seq_cst) != next) serving_.notify_all();

    // Sequentially consistent, with lockFromMain and whenFree: either they
    // see the lock free, or this sees them.
    if (attention_.load(std::memory_order_seq_cst) != 0) [[unlikely]]
      freed();
  }

  // --- the main thread --------------------------------------------------------

  /// Takes the lock for the main thread, which must answer now: waits for
  /// the holder in place (or borrows from an owner that lent it), ahead of
  /// queued tickets, which wait for it. `who` names the lock in the debug
  /// warning. Throws, as lock() does, rather than close a cycle.
  void lockFromMain(const char* who);

  /// Takes the lock for the main thread if it is free or lent, without
  /// waiting.
  bool tryLockFromMain();

  /// Posts `retry` to the main thread (postToMain) once the lock is next
  /// free or lent: at once if it is now.
  void whenFree(std::function<void()> retry);

  // --- lending -----------------------------------------------------------------

  /// The owner, about to run JavaScript synchronously (a callback): lends
  /// the lock to the main thread until unpark(). Returns what unpark()
  /// takes; nothing happens if the calling thread does not own the lock.
  unsigned park();

  /// Takes the lock back, waiting for a borrower to give it back.
  void unpark(unsigned parked);

  /// Whether a thread waiting for `wanted` while holding what it holds
  /// would close a cycle of waits. Registers the calling thread as waiting
  /// for it: until clearWait(). For the lock's waits and tests.
  static bool closesCycle(const LucentLock* wanted);
  static void clearWait();

 private:
  /// lent_: the owner keeps the lock, has lent it (the main thread may
  /// borrow it), or the main thread has borrowed it.
  static constexpr int kKept = 0;
  static constexpr int kLendable = 1;
  static constexpr int kBorrowed = 2;

  /// attention_ bits: main-thread entries waiting (counted from bit 1),
  /// retries to post.
  static constexpr int kRetries = 1;
  static constexpr int kMainWaiter = 2;

  void lockSlow(std::thread::id self);
  bool takeIfFree(std::thread::id self);
  void reclaim();
  void lend();
  void giveBack();
  bool tryBorrow();
  /// Released or lent: wakes the main thread, posts retries.
  void freed();
  /// Released while the main thread waits: it is the next owner.
  void handToMain();
  bool takeHandedToMain(std::thread::id self);
  /// Who the calling thread waits for when it waits for this lock.
  std::thread::id holder() const;

  /// The next ticket to hand out, and the one that holds the lock (or may
  /// take it). Equal: free.
  std::atomic<uint32_t> next_{0};
  std::atomic<uint32_t> serving_{0};

  std::atomic<std::thread::id> owner_{};
  unsigned depth_ = 0;
  /// The depth at which the owner lent the lock (0: not lent).
  unsigned parkedDepth_ = 0;

  std::atomic<int> lent_{kKept};
  std::atomic<std::thread::id> borrower_{};
  unsigned borrowDepth_ = 0;

  std::atomic<int> attention_{0};
  /// The main thread's wait: new tickets wait for it to end, and the owner
  /// hands it the lock (mainTurn_) when it leaves.
  std::atomic<int> mainWaiting_{0};
  std::atomic<bool> mainTurn_{false};
  std::mutex mainM_;
  std::condition_variable mainCv_;

  std::mutex retryM_;
  std::vector<std::function<void()>> retries_;
};

/// How long the main thread may wait for an actor before a debug build
/// warns (default 50 ms; 0: never). Any thread.
double mainWaitWarningMs();
void setMainWaitWarningMs(double ms);

/// A module actor: modules' code, serialized by its lock. Its turns run on
/// its own thread; synchronous calls from other threads (JavaScript's, or a
/// platform callback's) enter it by taking the lock, which is what makes it
/// current (ExecutionContext::current). Actors are never destroyed.
class Actor final : public ExecutionContext {
 public:
  /// The actor of code no other actor was given.
  static Actor& shared();

  /// A new actor, with a thread of its own: generated code makes one per
  /// import component (lucent_app::actor_N). `name` must outlive it (a
  /// literal).
  static Actor& create(const char* name);

  /// The innermost actor the calling thread is in, or null.
  static Actor* current();

  const char* name() const { return name_; }

  LucentLock& lock() { return lock_; }

  bool onActorThread() const { return worker_->isCurrent(); }

  bool isActor() const override { return true; }

  /// Jobs queued or running, and timers pending (for tests and shutdown).
  size_t pendingWork() { return worker_->pendingWork(); }

  /// Blocks until no jobs or timers are pending, or the timeout elapses.
  bool waitIdle(double timeoutMs) { return worker_->waitIdle(timeoutMs); }

  /// pendingWork() of every actor there is (for tests and tools).
  static size_t pendingWorkOfAll();

 private:
  explicit Actor(const char* name);

  static Actor* make(const char* name);

  bool dispatch(Job job) override { return worker_->post(std::move(job)); }
  bool dispatchDelayed(double ms, Job job) override { return worker_->postDelayed(ms, std::move(job)); }
  bool onExecutor() const override { return worker_->isCurrent(); }

  /// Holds the lock for the job and the microtasks after it.
  void runTurn(Job& job) override;

  const char* const name_;
  LucentLock lock_;
  std::shared_ptr<WorkerThread> worker_;
};

/// Entered for every call from JavaScript into Lucent code, and by platform
/// callbacks into module code (callNow): enters `actor` by holding its lock.
/// On exit off the actor's thread, hands pending microtasks to it; on its
/// thread, the enclosing turn runs them once its stack is empty.
class LucentScope {
 public:
  /// Waits for the lock as any thread does (LucentLock::lock).
  explicit LucentScope(Actor& actor) : actor_(actor) {
    if (trace::enabled()) [[unlikely]] {
      lockTraced(actor.lock());
    } else {
      actor.lock().lock();
    }

    push();
  }

  /// The shared actor.
  LucentScope() : LucentScope(Actor::shared()) {}

  /// The lock already taken (tryLockFromMain).
  LucentScope(Actor& actor, std::adopt_lock_t) : actor_(actor) { push(); }

  struct FromMain {};
  /// On the main thread, which must answer now (LucentLock::lockFromMain).
  LucentScope(Actor& actor, FromMain);

  ~LucentScope() {
    if (actor_.hasMicrotasks()) handOffMicrotasks();

    top_ = previous_;
    actor_.lock().unlock();
  }

  LucentScope(const LucentScope&) = delete;
  LucentScope& operator=(const LucentScope&) = delete;

  /// Takes `lock`, recording the wait as a span (a call's, or a turn's).
  static void lockTraced(LucentLock& lock);

  /// The innermost scope the calling thread is in, or null.
  static LucentScope* top() { return top_; }

  Actor& actor() const { return actor_; }
  LucentScope* previous() const { return previous_; }

 private:
  void push() {
    previous_ = top_;
    top_ = this;
  }

  void handOffMicrotasks();

  Actor& actor_;
  LucentScope* previous_ = nullptr;

  // Constant-initialized and trivially destroyed: one load where a call
  // reaches it, with no guard.
  static inline thread_local LucentScope* top_ = nullptr;
};

/// While it lives, lends every actor the calling thread holds to the main
/// thread (LucentLock::park): around a synchronous call into JavaScript,
/// which may wait for the main thread. A main-thread entry that runs then
/// is as if that JavaScript had made it.
class ParkedActors {
 public:
  ParkedActors();
  ~ParkedActors();

  ParkedActors(const ParkedActors&) = delete;
  ParkedActors& operator=(const ParkedActors&) = delete;

 private:
  struct Parked {
    LucentLock* lock;
    unsigned saved;
  };

  // Most threads hold one actor: no allocation for it.
  Parked first_{nullptr, 0};
  std::vector<Parked> more_;
};

}  // namespace lucent
