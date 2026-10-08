#include "compute.h"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <thread>

#include "report.h"

namespace lucent {

namespace {

/// The task running on this thread.
thread_local TaskContext* running = nullptr;

size_t defaultWorkers() {
  unsigned cores = std::thread::hardware_concurrency();
  return cores > 2 ? cores - 1 : 1;
}

}  // namespace

Error computeQueueFullError(size_t capacity) {
  return makeError(String::fromLatin1("QuotaExceededError"),
                   String::fromUtf8("The compute queue is full (" + std::to_string(capacity) + " tasks waiting)"));
}

Error computePoolClosedError() {
  return makeError(String::fromLatin1("InvalidStateError"), String::fromLatin1("The compute pool has shut down"));
}

Error computePoolShutdownError() {
  return makeError(String::fromLatin1("AbortError"), String::fromLatin1("The compute pool shut down"));
}

// --- TaskContext ----------------------------------------------------------------

TaskContext* TaskContext::current() noexcept { return running; }

void TaskContext::throwCancelled() {
  throwError(String::fromLatin1("AbortError"), String::fromLatin1("The task was cancelled"));
}

const std::shared_ptr<Scope>& TaskContext::scope() {
  if (scope_) return scope_;

  ExecutionContext* worker = ExecutionContext::current();
  if (running != this || !worker) throw std::logic_error("A task's scope is used on its worker, while it runs");

  scope_ = Scope::create(0, worker->root());
  return scope_;
}

void TaskContext::end() {
  auto scope = std::move(scope_);
  scope_ = nullptr;

  if (!scope) return;

  if (auto e = scope->dispose()) reportUncaught(e, "compute task");
}

// --- ComputeTask ----------------------------------------------------------------

detail::ComputeTask::~ComputeTask() {
  if (!sink_) return;

  TaskTiming timing;
  timing.entry = name_;
  timing.outcome = outcome_.load();
  timing.started = started_ != Time{};
  timing.admitted = admitted_;

  if (timing.started) {
    timing.waited = started_ - submitted_;

    if (finished_ != Time{}) timing.ran = finished_ - started_;
    if (finished_ != Time{} && settled_ != Time{}) timing.delivered = settled_ - finished_;
  }

  try {
    (*sink_)(timing);
  } catch (...) {
    reportUncaught(std::current_exception(), "compute timing");
  }
}

void detail::ComputeTask::delivered(OperationState outcome) {
  if (timed()) settled_ = now();

  outcome_.store(outcome);
}

void detail::ComputeTask::tracePhase(const char* ended, const char* next) noexcept {
  if (!traceId_) return;

  trace::end(phase_, trace::Category::Compute, ended, {.id = traceId_, .detail = name_});
  phase_ = next ? trace::begin(trace::Category::Compute, next) : trace::Mark{};
}

void detail::ComputeTask::finishRun() {
  context_.end();

  if (timed()) finished_ = now();

  if (ComputePool* pool = runningOn_) {
    std::lock_guard<std::mutex> g(pool->m_);
    pool->stats_.finished++;
  }
}

// --- ComputePool ----------------------------------------------------------------

std::shared_ptr<ComputePool> ComputePool::create(Options options) {
  return std::shared_ptr<ComputePool>(new ComputePool(options));
}

const std::shared_ptr<ComputePool>& ComputePool::shared() {
  // Leaked, like the process it serves.
  static auto* pool = new std::shared_ptr<ComputePool>(create());
  return *pool;
}

ComputePool::ComputePool(Options options) : capacity_(options.capacity ? options.capacity : kDefaultCapacity) {
  size_t count = options.workers ? options.workers : defaultWorkers();

  for (size_t i = 0; i < count; i++) workers_.push_back(IsolatedContext::create());

  // The first worker is handed out first.
  for (size_t i = count; i > 0; i--) idle_.push_back(i - 1);

  stats_.workers = count;
  stats_.capacity = capacity_;
}

ComputePool::~ComputePool() { shutdown(); }

std::function<void()> ComputePool::admit(const TaskRef& task, const AbortSignal& signal) {
  enum class Refusal { None, Full, Closed } refusal = Refusal::None;
  std::optional<size_t> worker;

  const bool timed = timing_.load(std::memory_order_relaxed);
  const auto before = timed ? detail::ComputeTask::now() : detail::ComputeTask::Time{};

  // Traced from here: waiting for a worker.
  if (trace::enabled()) [[unlikely]] {
    task->traceId_ = trace::newId();
    task->phase_ = trace::begin(trace::Category::Compute, "compute.wait");
  }

  size_t queued = 0;

  {
    std::lock_guard<std::mutex> g(m_);

    if (timed && sink_) {
      task->submitted_ = detail::ComputeTask::now();
      task->admitted_ = task->submitted_ - before;
      task->sink_ = sink_;
    }

    if (closed_) {
      refusal = Refusal::Closed;
    } else if (!idle_.empty()) {
      worker = idle_.back();
      idle_.pop_back();

      task->place_ = detail::ComputeTask::Place::Assigned;
      assigned_.push_back(task);

      stats_.submitted++;
      stats_.started++;
      stats_.peakRunning = std::max(stats_.peakRunning, assigned_.size());
    } else if (queue_.size() < capacity_) {
      task->place_ = detail::ComputeTask::Place::Queued;
      queue_.push_back(task);

      stats_.submitted++;
      stats_.saturated++;
      stats_.peakQueued = std::max(stats_.peakQueued, queue_.size());
      queued = queue_.size();
    } else {
      stats_.submitted++;
      stats_.rejected++;
      refusal = Refusal::Full;
    }
  }

  if (task->traceId_) {
    // Every worker busy: the task waits in the queue, this deep.
    if (queued) {
      trace::instant(trace::Category::Compute, "compute.saturated", {.id = task->traceId_, .value = static_cast<int64_t>(queued), .detail = task->name_});
      trace::counter("compute.queued", static_cast<int64_t>(queued));
    }

    if (refusal != Refusal::None) {
      trace::instant(trace::Category::Compute, "compute.rejected", {.id = task->traceId_, .detail = task->name_});
      task->tracePhase("compute.wait", nullptr);
    }
  }

  if (refusal == Refusal::Closed) throwError(computePoolClosedError());
  if (refusal == Refusal::Full) throwError(computeQueueFullError(capacity_));

  if (worker) dispatch(*worker, task);

  std::weak_ptr<detail::ComputeTask> weakTask = task;
  uint64_t listener = 0;

  if (signal) {
    std::weak_ptr<AbortSignalObject> weakSignal = signal;

    listener = signal->add([weakTask, weakSignal] {
      auto task = weakTask.lock();
      auto signal = weakSignal.lock();
      if (task && signal) task->abandon(signal->reason);
    });

    // Refused on the signal's owner: it aborted since the submission began.
    if (listener == 0) task->abandon(signal->reason);
  }

  std::weak_ptr<ComputePool> weakPool = weak_from_this();

  return [weakPool, weakTask, signal, listener] {
    if (signal && listener) signal->remove(listener);

    auto task = weakTask.lock();
    if (!task) return;

    // Settled: whatever the task produces from now on is released.
    task->context_.cancel();

    if (auto pool = weakPool.lock()) pool->withdraw(task);
  };
}

void ComputePool::dispatch(size_t index, TaskRef task) {
  auto self = shared_from_this();

  // Refused only once the pool has shut down, which cancelled the task.
  workers_[index]->post([self, index, task = std::move(task)]() mutable { self->runOn(index, std::move(task)); });
}

void ComputePool::runOn(size_t index, TaskRef task) {
  if (task->timed()) task->started_ = detail::ComputeTask::now();

  task->tracePhase("compute.wait", "compute.run");
  task->runningOn_ = this;

  bool posted;
  {
    struct Running {
      explicit Running(TaskContext* task) { running = task; }
      ~Running() { running = nullptr; }
    } current(&task->context_);

    posted = task->run();
  }

  TaskRef next;
  {
    std::lock_guard<std::mutex> g(m_);

    auto it = std::find(assigned_.begin(), assigned_.end(), task);
    if (it != assigned_.end()) assigned_.erase(it);
    task->place_ = detail::ComputeTask::Place::None;
    task->runningOn_ = nullptr;

    // Finished was counted before the outcome left (finishRun).
    if (!posted) stats_.abandoned++;

    if (!closed_ && !queue_.empty()) {
      next = std::move(queue_.front());
      queue_.pop_front();

      next->place_ = detail::ComputeTask::Place::Assigned;
      assigned_.push_back(next);
      stats_.started++;
    } else {
      idle_.push_back(index);
    }
  }

  // Outside the lock: the last reference may go, with what the task held.
  task = nullptr;

  // A turn of its own, so the worker's microtasks and other jobs run between.
  if (next) dispatch(index, std::move(next));
}

void ComputePool::withdraw(const TaskRef& task) {
  TaskRef removed;

  {
    std::lock_guard<std::mutex> g(m_);

    if (task->place_ != detail::ComputeTask::Place::Queued) return;

    auto it = std::find(queue_.begin(), queue_.end(), task);
    removed = std::move(*it);
    queue_.erase(it);

    task->place_ = detail::ComputeTask::Place::None;
    stats_.cancelledQueued++;
  }

  removed->tracePhase("compute.wait", nullptr);
}

void ComputePool::shutdown() {
  std::deque<TaskRef> queued;
  std::vector<TaskRef> assigned;

  {
    std::lock_guard<std::mutex> g(m_);

    if (closed_) return;

    closed_ = true;
    queued.swap(queue_);
    assigned.swap(assigned_);

    for (auto& task : queued) task->place_ = detail::ComputeTask::Place::None;
    stats_.cancelledQueued += queued.size();
  }

  Error reason = computePoolShutdownError();

  for (auto& task : assigned) {
    task->context_.cancel();
    task->abandon(reason);
  }

  for (auto& task : queued) {
    task->abandon(reason);
    task->tracePhase("compute.wait", nullptr);
  }

  for (auto& worker : workers_) worker->shutdown();
}

bool ComputePool::waitStopped(double timeoutMs) {
  auto deadline = std::chrono::steady_clock::now() + std::chrono::microseconds(static_cast<int64_t>(timeoutMs * 1000));

  for (auto& worker : workers_) {
    double left = std::chrono::duration<double, std::milli>(deadline - std::chrono::steady_clock::now()).count();
    if (!worker->waitStopped(std::max(left, 0.0))) return false;
  }

  return true;
}

ComputeStats ComputePool::stats() const {
  std::lock_guard<std::mutex> g(m_);

  ComputeStats stats = stats_;
  stats.queued = queue_.size();
  stats.running = assigned_.size();
  return stats;
}

void ComputePool::setTimingSink(TimingSink sink) {
  std::shared_ptr<const TimingSink> replaced = sink ? std::make_shared<const TimingSink>(std::move(sink)) : nullptr;

  {
    std::lock_guard<std::mutex> g(m_);

    std::swap(sink_, replaced);
    timing_.store(sink_ != nullptr, std::memory_order_relaxed);
  }

  // The old sink, if no task still holds it, goes here, outside the lock.
}

}  // namespace lucent
