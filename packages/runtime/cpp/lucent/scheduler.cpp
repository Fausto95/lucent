#include "scheduler.h"

namespace lucent {

Scheduler::Scheduler() : ExecutionContext(&microtaskCount_) {
  // The module context starts with the first module: tracing asked for by
  // the environment (LUCENT_TRACE) starts with it.
  trace::startFromEnvironment();

  worker_ = WorkerThread::start([this](Job& job) { runTurn(job); });
}

namespace {
/// The scheduler's owner, leaked on purpose (jobs may still reference the
/// scheduler during static destruction at process exit), and kept
/// reachable: a leak checker (LeakSanitizer) reports what it cannot reach.
std::shared_ptr<Scheduler>* keptScheduler = nullptr;
}  // namespace

Scheduler& Scheduler::instance() {
  // The scheduler itself, one load away on the call path.
  static Scheduler* s = [] {
    keptScheduler = new std::shared_ptr<Scheduler>(new Scheduler());
    (*keptScheduler)->makeRoot();
    return keptScheduler->get();
  }();
  return *s;
}

void Scheduler::runTurn(Job& job) {
  if (trace::enabled()) [[unlikely]] {
    LucentScope::lockTraced(lock_);
  } else {
    lock_.lock();
  }

  std::lock_guard<LucentLock> lucent(lock_, std::adopt_lock);

  {
    Job local = std::move(job);
    detail::runGuarded(local, "job");
  }

  drainMicrotasks();
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
  Scheduler& s = Scheduler::instance();

  // Continuations run on the Lucent thread, never on the JS thread. There,
  // the turn this scope is nested in runs them after its job.
  if (!s.onLucentThread()) s.post([] {});
}

}  // namespace lucent
