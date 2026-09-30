#include "execution.h"

#include <mutex>
#include <stdexcept>

// The legacy module context is entered by its lock rather than by the
// thread-local below, so current() asks the lock first.
#include "scheduler.h"
#include "trace.h"

namespace lucent {

namespace {

// Constant-initialized: safe to use during static initialization.
std::atomic<ContextId> nextContextId{1};

// The context this thread entered, other than the legacy module context.
thread_local ExecutionContext* entered = nullptr;

/// Runs the main context's timers: the platform's main loop has none that
/// every platform shares, and they must not wait behind module code.
WorkerThread& clock() {
  static auto* thread = new std::shared_ptr<WorkerThread>(WorkerThread::start([](Job& job) { detail::runGuarded(job, "job"); }));
  return **thread;
}

class MainContext final : public ExecutionContext {
 public:
  MainContext() = default;

 private:
  bool dispatch(Job job) override {
    postToMain([this, job = std::move(job)]() mutable { runTurn(job); });
    return true;
  }

  bool dispatchDelayed(double ms, Job job) override {
    return clock().postDelayed(ms, [this, job = std::move(job)]() mutable { post(std::move(job)); });
  }

  bool onExecutor() const override { return onMainThread(); }
};

}  // namespace

void detail::runGuarded(Job& job, const char* where) {
  try {
    job();
  } catch (...) {
    reportUncaught(std::current_exception(), where);
  }
}

void detail::runOn(ExecutionContext* on, Job job) {
  if (on && !on->onExecutor()) {
    // Kept here as well: a context that refuses the job destroys it.
    auto kept = std::make_shared<Job>(std::move(job));
    if (on->post([kept] { (*kept)(); })) return;

    job = std::move(*kept);
  }

  job();
}

// --- WorkerThread ---------------------------------------------------------------

std::shared_ptr<WorkerThread> WorkerThread::start(Run run) {
  std::shared_ptr<WorkerThread> worker(new WorkerThread(std::move(run)));

  std::thread thread([worker] { worker->loop(); });
  worker->id_ = thread.get_id();
  thread.detach();

  return worker;
}

bool WorkerThread::post(Job job) {
  {
    std::lock_guard<std::mutex> g(m_);

    if (stopping_) return false;

    jobs_.push_back(std::move(job));
  }

  cv_.notify_one();
  return true;
}

bool WorkerThread::postDelayed(double ms, Job job) {
  if (!(ms > 0)) ms = 0;
  auto at = std::chrono::steady_clock::now() + std::chrono::microseconds(static_cast<int64_t>(ms * 1000));

  {
    std::lock_guard<std::mutex> g(m_);

    if (stopping_) return false;

    timers_.push(Timer{at, timerSeq_++, std::move(job)});
  }

  cv_.notify_one();
  return true;
}

size_t WorkerThread::pendingWork() {
  std::lock_guard<std::mutex> g(m_);
  return jobs_.size() + timers_.size() + running_;
}

bool WorkerThread::waitIdle(double timeoutMs) {
  std::unique_lock<std::mutex> g(m_);
  return idleCv_.wait_for(g, std::chrono::microseconds(static_cast<int64_t>(timeoutMs * 1000)),
                          [this] { return stopped_ || (jobs_.empty() && timers_.empty() && running_ == 0); });
}

void WorkerThread::stop(Job last) {
  {
    std::lock_guard<std::mutex> g(m_);

    if (stopping_) return;

    stopping_ = true;
    last_ = std::move(last);
  }

  cv_.notify_all();
}

bool WorkerThread::waitStopped(double timeoutMs) {
  std::unique_lock<std::mutex> g(m_);
  return idleCv_.wait_for(g, std::chrono::microseconds(static_cast<int64_t>(timeoutMs * 1000)), [this] { return stopped_; });
}

void WorkerThread::loop() {
  std::unique_lock<std::mutex> g(m_);

  while (!stopping_) {
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

      run_(job);
      // Unlocked: what the job captured may post again.
      job = nullptr;

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

  Job last = std::move(last_);
  std::deque<Job> dropped;
  dropped.swap(jobs_);
  auto timers = std::move(timers_);
  g.unlock();

  if (last) detail::runGuarded(last, "job");

  // Released here, on this thread, like the jobs that ran.
  last = nullptr;
  dropped.clear();
  timers = {};

  g.lock();
  stopped_ = true;
  g.unlock();
  idleCv_.notify_all();
}

// --- ExecutionContext -----------------------------------------------------------

ExecutionContext::ExecutionContext(size_t* microtaskCount)
    : id_(nextContextId.fetch_add(1, std::memory_order_relaxed)),
      pendingMicrotasks_(microtaskCount ? microtaskCount : &ownMicrotasks_) {}

ExecutionContext* ExecutionContext::current() {
  if (Scheduler::lock().heldByCurrentThread()) return &Scheduler::instance();

  return entered;
}

ContextRef ExecutionContext::currentRef() {
  if (Scheduler::lock().heldByCurrentThread()) return nullptr;

  ExecutionContext* context = entered;
  return context ? context->shared_from_this() : nullptr;
}

ExecutionContext& ExecutionContext::legacy() { return Scheduler::instance(); }

namespace {

struct ModuleScope {
  std::mutex m;
  std::shared_ptr<Scope> scope;
};

/// Never destroyed: a scope released during static destruction could need
/// contexts already gone.
ModuleScope& moduleScopeState() {
  static auto* state = new ModuleScope();
  return *state;
}

}  // namespace

std::shared_ptr<Scope> moduleScope() {
  ModuleScope& state = moduleScopeState();

  {
    std::lock_guard<std::mutex> g(state.m);
    if (state.scope) return state.scope;
  }

  return ExecutionContext::legacy().root();
}

void setModuleScope(std::shared_ptr<Scope> scope) {
  ModuleScope& state = moduleScopeState();
  std::lock_guard<std::mutex> g(state.m);

  state.scope = std::move(scope);
}

ExecutionContext& ExecutionContext::main() {
  // Leaked, like the main loop it stands for.
  static auto* context = [] {
    auto* kept = new std::shared_ptr<MainContext>(std::make_shared<MainContext>());
    (*kept)->makeRoot();
    return kept;
  }();
  return **context;
}

namespace {

/// `job`, recording how long it waits for its owner and how long it runs,
/// under one correlation id: the one a Correlate carried from the caller
/// (a JS call), or a new one. The job running where it was posted is its
/// parent.
Job traced(Job job) {
  uint64_t id = trace::takeCorrelation();
  if (!id) id = trace::newId();

  uint64_t parent = trace::currentId();
  trace::Mark wait = trace::begin(trace::Category::Queue, "wait");

  return [job = std::move(job), id, parent, wait]() mutable {
    trace::end(wait, trace::Category::Queue, "wait", {.id = id, .parent = parent});

    struct Running {
      trace::Mark mark = trace::begin(trace::Category::Run, "run");
      trace::Current current;
      uint64_t id;
      uint64_t parent;

      Running(uint64_t id, uint64_t parent) : current(id), id(id), parent(parent) {}

      ~Running() { trace::end(mark, trace::Category::Run, "run", {.id = id, .parent = parent}); }
    } running(id, parent);

    job();
  };
}

}  // namespace

bool ExecutionContext::post(Job job) {
  if (trace::enabled()) [[unlikely]]
    job = traced(std::move(job));

  return dispatch(std::move(job));
}

bool ExecutionContext::post(Job job, const std::shared_ptr<Scope>& owner) {
  if (!owner) return post(std::move(job));

  if (owner->state() != Scope::State::Active) return false;

  std::weak_ptr<Scope> weak = owner;
  Generation generation = owner->generation();

  return post([weak, generation, job = std::move(job)]() mutable {
    auto scope = weak.lock();
    if (!scope || scope->state() != Scope::State::Active || scope->generation() != generation) return;

    job();
  });
}

bool ExecutionContext::postDelayed(double ms, Job job) { return dispatchDelayed(ms, std::move(job)); }

void ExecutionContext::enqueueMicrotask(Job job) {
  if (!isCurrent()) throw std::logic_error("A microtask is queued on its own context; post to another one");

  microtasks_.push_back(std::move(job));
  ++*pendingMicrotasks_;
}

void ExecutionContext::drainMicrotasks() {
  if (!isCurrent()) throw std::logic_error("A context's microtasks run on that context");

  while (!microtasks_.empty()) {
    Job job = std::move(microtasks_.front());
    microtasks_.pop_front();
    --*pendingMicrotasks_;

    detail::runGuarded(job, "job");
  }
}

void ExecutionContext::runTurn(Job& job) {
  ContextEntry entry(*this);
  Job local = std::move(job);

  detail::runGuarded(local, "job");
}

// --- ContextEntry ---------------------------------------------------------------

ContextEntry::ContextEntry(ExecutionContext& context) : context_(context), previous_(entered) {
  if (&context == &ExecutionContext::legacy()) throw std::logic_error("The legacy module context is entered with LucentScope");

  if (Scheduler::lock().heldByCurrentThread()) {
    throw std::logic_error("Code holding the Lucent lock cannot enter another context; post to it");
  }

  if (previous_ && previous_ != &context) throw std::logic_error("A context cannot enter another one; post to it");

  if (!context.onExecutor()) throw std::logic_error("A context is entered only on its own thread; post to it");

  entered = &context;
}

ContextEntry::~ContextEntry() {
  // The outermost entry: the stack is empty once it leaves.
  if (previous_ != &context_) context_.drainMicrotasks();

  entered = previous_;
}

// --- IsolatedContext ------------------------------------------------------------

IsolatedContext::IsolatedContext() = default;

std::shared_ptr<IsolatedContext> IsolatedContext::create() {
  std::shared_ptr<IsolatedContext> context(new IsolatedContext());
  std::weak_ptr<IsolatedContext> weak = context;

  context->makeRoot();

  // A job whose context is gone is dropped, destroyed on the thread.
  context->worker_ = WorkerThread::start([weak](Job& job) {
    if (auto self = weak.lock()) self->runTurn(job);
  });

  return context;
}

IsolatedContext::~IsolatedContext() { shutdown(); }

void IsolatedContext::shutdown() {
  if (stopping_.exchange(true)) return;

  // Expired when called from the destructor: the root is then disposed
  // outside a turn.
  std::weak_ptr<ExecutionContext> weak = weak_from_this();

  worker_->stop([weak, root = root()] {
    Job dispose = [root] {
      if (auto e = root->dispose()) reportUncaught(e, "scope");
    };

    if (auto self = weak.lock()) {
      static_cast<IsolatedContext&>(*self).runTurn(dispose);
    } else {
      dispose();
    }
  });
}

bool IsolatedContext::dispatch(Job job) {
  if (stopping_.load()) return false;

  return worker_->post(std::move(job));
}

bool IsolatedContext::dispatchDelayed(double ms, Job job) {
  if (stopping_.load()) return false;

  return worker_->postDelayed(ms, std::move(job));
}

}  // namespace lucent
