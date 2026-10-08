#include "scheduler.h"

#include <chrono>
#include <cstdio>
#include <string>
#include <unordered_map>

#include "jserror.h"

namespace lucent {

namespace {

using Clock = std::chrono::steady_clock;

std::atomic<double> mainWaitWarning{50};

/// Which lock each thread waiting nested (holding an actor) waits for.
struct Waits {
  std::mutex m;
  std::unordered_map<std::thread::id, const LucentLock*> waiting;
};

/// Never destroyed: actors' threads may wait during static destruction.
Waits& waits() {
  static auto* w = new Waits();
  return *w;
}

/// How long the main thread sleeps between looks at a lock it waits for,
/// should a wake-up be missed.
constexpr auto kMainSlice = std::chrono::milliseconds(5);

[[noreturn]] void throwDeadlock() {
  throw Exception(makeError(
      String::fromLatin1("Error"),
      String::fromLatin1("Lucent: deadlock: this call into another module waits for a module that waits for one this thread "
                         "holds; make the call later (from a promise callback) instead")));
}

/// Registers the wait for `wanted` and refuses one that closes a cycle. A
/// cycle seen once may be one that is coming apart (a holder about to take
/// what it waited for): it must still be there a moment later.
void checkCycle(const LucentLock* wanted) {
  if (!LucentLock::closesCycle(wanted)) return;

  std::this_thread::sleep_for(std::chrono::milliseconds(1));

  if (!LucentLock::closesCycle(wanted)) return;

  LucentLock::clearWait();
  throwDeadlock();
}

}  // namespace

double mainWaitWarningMs() { return mainWaitWarning.load(); }

void setMainWaitWarningMs(double ms) { mainWaitWarning.store(ms > 0 ? ms : 0); }

// --- LucentLock -------------------------------------------------------------------

bool LucentLock::takeIfFree(std::thread::id self) {
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

void LucentLock::lockSlow(std::thread::id self) {
  // Holding another actor: this wait must not close a cycle.
  const bool nested = LucentScope::top() != nullptr;

  if (nested) {
    if (takeIfFree(self)) return;

    checkCycle(this);
  } else if (mainWaiting_.load(std::memory_order_seq_cst) != 0) [[unlikely]] {
    // The main thread waits for the holder: it goes first. A thread that
    // holds an actor does not wait for it, so this wait is in no cycle.
    for (int v; (v = mainWaiting_.load(std::memory_order_seq_cst)) != 0;) mainWaiting_.wait(v, std::memory_order_seq_cst);
  }

  // Sequentially consistent, with unlock(): either it sees this ticket and
  // wakes the waiters, or this thread sees the ticket it serves.
  const uint32_t ticket = next_.fetch_add(1, std::memory_order_seq_cst);

  uint32_t serving = serving_.load(std::memory_order_seq_cst);
  while (serving != ticket) {
    serving_.wait(serving, std::memory_order_relaxed);
    serving = serving_.load(std::memory_order_seq_cst);
  }

  owner_.store(self, std::memory_order_relaxed);
  depth_ = 1;

  if (nested) clearWait();
}

std::thread::id LucentLock::holder() const {
  if (lent_.load(std::memory_order_seq_cst) == kBorrowed) {
    std::thread::id borrower = borrower_.load(std::memory_order_seq_cst);
    if (borrower != std::thread::id()) return borrower;
  }

  return owner_.load(std::memory_order_seq_cst);
}

bool LucentLock::closesCycle(const LucentLock* wanted) {
  Waits& w = waits();
  std::lock_guard<std::mutex> g(w.m);
  const std::thread::id self = std::this_thread::get_id();

  w.waiting[self] = wanted;

  // Each step: the thread holding the lock, then the lock that thread
  // waits for. Bounded: a chain longer than the threads is a stale read.
  const LucentLock* at = wanted;
  for (size_t steps = 0; at && steps <= w.waiting.size(); steps++) {
    std::thread::id holder = at->holder();
    if (holder == std::thread::id()) return false;
    if (holder == self) return true;

    auto it = w.waiting.find(holder);
    if (it == w.waiting.end()) return false;
    at = it->second;
  }

  return false;
}

void LucentLock::clearWait() {
  Waits& w = waits();
  std::lock_guard<std::mutex> g(w.m);
  w.waiting.erase(std::this_thread::get_id());
}

void LucentLock::reclaim() {
  for (;;) {
    int seen = kLendable;
    if (lent_.compare_exchange_strong(seen, kKept, std::memory_order_seq_cst)) return;
    if (seen == kKept) return;

    // The main thread has it: until it gives it back.
    lent_.wait(kBorrowed, std::memory_order_seq_cst);
  }
}

void LucentLock::lend() {
  lent_.store(kLendable, std::memory_order_seq_cst);

  if (attention_.load(std::memory_order_seq_cst) != 0) freed();
}

bool LucentLock::tryBorrow() {
  int seen = kLendable;
  if (!lent_.compare_exchange_strong(seen, kBorrowed, std::memory_order_seq_cst)) return false;

  borrower_.store(std::this_thread::get_id(), std::memory_order_seq_cst);
  borrowDepth_ = 1;
  return true;
}

void LucentLock::giveBack() {
  if (--borrowDepth_ > 0) return;

  borrower_.store(std::thread::id(), std::memory_order_seq_cst);
  lent_.store(kLendable, std::memory_order_seq_cst);
  lent_.notify_all();

  if (attention_.load(std::memory_order_seq_cst) != 0) freed();
}

unsigned LucentLock::park() {
  if (owner_.load(std::memory_order_relaxed) != std::this_thread::get_id()) return 0;

  unsigned saved = parkedDepth_;
  parkedDepth_ = depth_;
  lend();
  return saved + 1;
}

void LucentLock::unpark(unsigned parked) {
  if (parked == 0) return;

  reclaim();
  parkedDepth_ = parked - 1;
}

void LucentLock::freed() {
  if (mainWaiting_.load(std::memory_order_seq_cst) != 0) {
    std::lock_guard<std::mutex> g(mainM_);
    mainCv_.notify_all();
  }

  if (!(attention_.load(std::memory_order_seq_cst) & kRetries)) return;

  std::vector<std::function<void()>> due;
  {
    std::lock_guard<std::mutex> g(retryM_);
    due.swap(retries_);
    attention_.fetch_and(~kRetries, std::memory_order_seq_cst);
  }

  for (auto& retry : due) postToMain(std::move(retry));
}

void LucentLock::handToMain() {
  mainTurn_.store(true, std::memory_order_seq_cst);

  std::lock_guard<std::mutex> g(mainM_);
  mainCv_.notify_all();
}

bool LucentLock::takeHandedToMain(std::thread::id self) {
  if (!mainTurn_.exchange(false, std::memory_order_seq_cst)) return false;

  owner_.store(self, std::memory_order_relaxed);
  depth_ = 1;
  return true;
}

bool LucentLock::tryLockFromMain() {
  std::thread::id self = std::this_thread::get_id();

  if (owner_.load(std::memory_order_relaxed) == self || borrower_.load(std::memory_order_relaxed) == self) {
    lock();
    return true;
  }

  return takeIfFree(self) || tryBorrow();
}

void LucentLock::lockFromMain(const char* who) {
  if (tryLockFromMain()) return;

  const std::thread::id self = std::this_thread::get_id();
  const bool nested = LucentScope::top() != nullptr;
  if (nested) checkCycle(this);

  // Before looking at the lock, so an unlock that frees it after the look
  // sees this wait and wakes it.
  mainWaiting_.fetch_add(1, std::memory_order_seq_cst);
  attention_.fetch_add(kMainWaiter, std::memory_order_seq_cst);

  const auto start = Clock::now();
  [[maybe_unused]] bool warned = false;

  {
    std::unique_lock<std::mutex> g(mainM_);

    while (!takeHandedToMain(self) && !takeIfFree(self) && !tryBorrow()) {
      mainCv_.wait_for(g, kMainSlice);

#ifndef NDEBUG
      double limit = mainWaitWarningMs();
      double waited = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
      if (!warned && limit > 0 && waited >= limit) {
        warned = true;
        std::string message = "[lucent] the main thread has waited " + std::to_string(static_cast<long>(waited)) + " ms for " +
                              (who ? who : "a module") +
                              ", which module code holds: keep synchronous delegates and module jobs short";
        logError(message.c_str());
      }
#endif
    }
  }

  attention_.fetch_sub(kMainWaiter, std::memory_order_seq_cst);
  if (mainWaiting_.fetch_sub(1, std::memory_order_seq_cst) == 1) mainWaiting_.notify_all();

  if (nested) clearWait();
}

void LucentLock::whenFree(std::function<void()> retry) {
  {
    std::lock_guard<std::mutex> g(retryM_);
    retries_.push_back(std::move(retry));
    attention_.fetch_or(kRetries, std::memory_order_seq_cst);
  }

  // Free or lent already: no release will come to post it.
  if (serving_.load(std::memory_order_seq_cst) == next_.load(std::memory_order_seq_cst) ||
      lent_.load(std::memory_order_seq_cst) == kLendable)
    freed();
}

// --- Actor -------------------------------------------------------------------------

namespace {
/// Every actor, leaked on purpose (jobs may still reference one during
/// static destruction at process exit), and kept reachable: a leak checker
/// (LeakSanitizer) reports what it cannot reach.
struct Actors {
  std::mutex m;
  std::vector<std::shared_ptr<Actor>> all;
};

Actors& actors() {
  static auto* a = new Actors();
  return *a;
}
}  // namespace

Actor::Actor(const char* name) : name_(name) {}

Actor* Actor::make(const char* name) {
  std::shared_ptr<Actor> actor(new Actor(name));
  actor->makeRoot();

  Actor* self = actor.get();
  actor->worker_ = WorkerThread::start([self](Job& job) { self->runTurn(job); });

  Actors& a = actors();
  std::lock_guard<std::mutex> g(a.m);
  a.all.push_back(std::move(actor));
  return self;
}

Actor& Actor::shared() {
  // The actor itself, one load away on the call path.
  static Actor* s = [] {
    // The module context starts with the first module: tracing asked for by
    // the environment (LUCENT_TRACE) starts with it.
    trace::startFromEnvironment();
    return make("module");
  }();
  return *s;
}

Actor& Actor::create(const char* name) {
  // Started with the first, so tracing from the environment covers it.
  shared();
  return *make(name);
}

size_t Actor::pendingWorkOfAll() {
  std::vector<Actor*> all;
  {
    Actors& a = actors();
    std::lock_guard<std::mutex> g(a.m);
    for (auto& actor : a.all) all.push_back(actor.get());
  }

  size_t n = 0;
  for (Actor* actor : all) n += actor->pendingWork();
  return n;
}

Actor* Actor::current() {
  LucentScope* top = LucentScope::top();
  return top ? &top->actor() : nullptr;
}

void Actor::runTurn(Job& job) {
  if (trace::enabled()) [[unlikely]] {
    LucentScope::lockTraced(lock_);
  } else {
    lock_.lock();
  }

  LucentScope held(*this, std::adopt_lock);

  {
    Job local = std::move(job);
    detail::runGuarded(local, "job");
  }

  drainMicrotasks();
}

// --- LucentScope ---------------------------------------------------------------------

LucentScope::LucentScope(Actor& actor, FromMain) : actor_(actor) {
  actor.lock().lockFromMain(actor.name());
  push();
}

void LucentScope::lockTraced(LucentLock& lock) {
  // Already held here (a nested call): no wait to record.
  if (lock.heldByCurrentThread()) {
    lock.lock();
    return;
  }

  trace::Mark wait = trace::begin(trace::Category::Lock, "lucent-lock");
  lock.lock();
  trace::end(wait, trace::Category::Lock, "lucent-lock", {.parent = trace::currentId()});
}

void LucentScope::handOffMicrotasks() {
  // Continuations run on the actor's thread, never on the JS thread. There,
  // the turn this scope is nested in runs them after its job.
  if (!actor_.onActorThread()) actor_.post([] {});
}

// --- ParkedActors --------------------------------------------------------------------

ParkedActors::ParkedActors() {
  for (LucentScope* s = LucentScope::top(); s; s = s->previous()) {
    LucentLock* lock = &s->actor().lock();

    bool seen = first_.lock == lock;
    for (auto& p : more_) seen = seen || p.lock == lock;
    if (seen) continue;

    unsigned saved = lock->park();
    if (!saved) continue;

    if (!first_.lock) {
      first_ = {lock, saved};
    } else {
      more_.push_back({lock, saved});
    }
  }
}

ParkedActors::~ParkedActors() {
  for (auto it = more_.rbegin(); it != more_.rend(); ++it) it->lock->unpark(it->saved);
  if (first_.lock) first_.lock->unpark(first_.saved);
}

}  // namespace lucent
