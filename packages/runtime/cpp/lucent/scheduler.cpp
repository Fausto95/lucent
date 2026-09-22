#include "scheduler.h"

#include <cstdio>
#include <exception>

namespace lucent {

namespace {
void runGuarded(const Scheduler::Job& job) {
  try {
    job();
  } catch (const std::exception& e) {
    std::fprintf(stderr, "[lucent] uncaught exception in job: %s\n", e.what());
  } catch (...) {
    std::fprintf(stderr, "[lucent] uncaught exception in job\n");
  }
}
}  // namespace

Scheduler& Scheduler::instance() {
  // Leaked on purpose: jobs may still reference the scheduler during static
  // destruction at process exit.
  static Scheduler* s = new Scheduler();
  return *s;
}

Scheduler::Scheduler() {
  thread_ = std::thread([this] { run(); });
  threadId_ = thread_.get_id();
}

Scheduler::~Scheduler() {
  {
    std::lock_guard<std::mutex> g(queueMutex_);
    stopping_ = true;
  }
  cv_.notify_all();
  if (thread_.joinable()) thread_.join();
}

void Scheduler::post(Job job) {
  {
    std::lock_guard<std::mutex> g(queueMutex_);
    jobs_.push_back(std::move(job));
  }
  cv_.notify_one();
}

void Scheduler::postDelayed(double ms, Job job) {
  if (!(ms > 0)) ms = 0;
  auto at = std::chrono::steady_clock::now() + std::chrono::microseconds(static_cast<int64_t>(ms * 1000));
  {
    std::lock_guard<std::mutex> g(queueMutex_);
    timers_.push(Timer{at, timerSeq_++, std::move(job)});
  }
  cv_.notify_one();
}

void Scheduler::enqueueMicrotask(Job job) { microtasks_.push_back(std::move(job)); }

void Scheduler::drainMicrotasks() {
  while (!microtasks_.empty()) {
    Job job = std::move(microtasks_.front());
    microtasks_.pop_front();
    runGuarded(job);
  }
}

size_t Scheduler::pendingWork() {
  std::lock_guard<std::mutex> g(queueMutex_);
  return jobs_.size() + timers_.size() + running_;
}

bool Scheduler::waitIdle(double timeoutMs) {
  std::unique_lock<std::mutex> g(queueMutex_);
  return idleCv_.wait_for(g, std::chrono::microseconds(static_cast<int64_t>(timeoutMs * 1000)),
                          [this] { return jobs_.empty() && timers_.empty() && running_ == 0; });
}

void Scheduler::run() {
  std::unique_lock<std::mutex> g(queueMutex_);
  for (;;) {
    if (stopping_) return;
    auto now = std::chrono::steady_clock::now();
    while (!timers_.empty() && timers_.top().at <= now) {
      jobs_.push_back(std::move(const_cast<Timer&>(timers_.top()).job));
      timers_.pop();
    }
    if (!jobs_.empty()) {
      Job job = std::move(jobs_.front());
      jobs_.pop_front();
      running_++;
      g.unlock();
      {
        std::lock_guard<std::recursive_mutex> lucent(lock_);
        runGuarded(job);
        drainMicrotasks();
      }
      g.lock();
      running_--;
      if (jobs_.empty() && timers_.empty() && running_ == 0) idleCv_.notify_all();
      continue;
    }
    if (timers_.empty()) {
      cv_.wait(g);
    } else {
      // A copy: wait_until reads the deadline after unlocking, when a
      // postDelayed may have reallocated the heap.
      const auto deadline = timers_.top().at;
      cv_.wait_until(g, deadline);
    }
  }
}

LucentScope::~LucentScope() {
  Scheduler& s = Scheduler::instance();
  if (s.hasMicrotasks()) {
    if (s.onLucentThread()) {
      s.drainMicrotasks();
    } else {
      // Continuations run on the Lucent thread, never on the JS thread.
      s.post([] {});
    }
  }
}

}  // namespace lucent
