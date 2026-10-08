// JSI tests for the Host: each JS runtime's Lucent side, its lifetime and
// what outlives it. Runtimes run in Hermes, each on a thread of its own as
// React Native's JS thread, with a hand-written module ("t") in the shape
// the compiler generates. Built and run by `run.sh` in this directory.
#include <hermes/hermes.h>
#include <jsi/instrumentation.h>
#include <jsi/jsi.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <type_traits>

#include "lucent/compute.h"
#include "lucent/operation.h"
#include "lucent/jsi/convert.h"
#include "lucent/jsi/host.h"
#include "lucent/trace.h"
#include "rn/LucentViewRequests.h"

namespace jsi = facebook::jsi;
using namespace lucent;
using namespace lucent::js;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                                 \
  do {                                                                              \
    checks++;                                                                       \
    if (!(cond)) {                                                                  \
      failures++;                                                                   \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                               \
  } while (0)

using Clock = std::chrono::steady_clock;

/// Polls `done` for up to `ms` milliseconds.
template <class F>
static bool within(int ms, F done) {
  auto deadline = Clock::now() + std::chrono::milliseconds(ms);

  while (!done()) {
    if (Clock::now() > deadline) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  return true;
}

// --- a JS thread ----------------------------------------------------------------

/// A Hermes runtime on a thread of its own. Tasks run one at a time, each
/// followed by the runtime's microtasks. Once the runtime is destroyed (a
/// reload), tasks posted for it are dropped there, as React Native's
/// scheduler drops them.
class JsThread {
 public:
  JsThread() : thread_([this] { loop(); }) {
    run([](jsi::Runtime&) {});
  }

  ~JsThread() {
    {
      std::lock_guard<std::mutex> g(m_);
      stopping_ = true;
      paused_ = false;
    }

    cv_.notify_all();
    thread_.join();
  }

  JsThread(const JsThread&) = delete;
  JsThread& operator=(const JsThread&) = delete;

  /// Runs `f` with the runtime on the JS thread; the caller waits for it.
  template <class F>
  auto run(F f) -> std::invoke_result_t<F&, jsi::Runtime&> {
    using R = std::invoke_result_t<F&, jsi::Runtime&>;
    auto done = std::make_shared<std::promise<R>>();
    std::future<R> result = done->get_future();

    post([this, f = std::move(f), done]() mutable {
      try {
        if constexpr (std::is_void_v<R>) {
          f(*runtime_);
          done->set_value();
        } else {
          done->set_value(f(*runtime_));
        }
      } catch (...) {
        done->set_exception(std::current_exception());
      }
    });

    return result.get();
  }

  /// Evaluates `source` on the JS thread.
  void eval(const std::string& source) {
    run([&](jsi::Runtime& rt) { rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source), "test.js"); });
  }

  /// The number `expression` evaluates to, on the JS thread.
  double number(const std::string& expression) {
    return run([&](jsi::Runtime& rt) {
      return rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(expression), "test.js").asNumber();
    });
  }

  /// The string `expression` evaluates to, on the JS thread.
  std::string string(const std::string& expression) {
    return run([&](jsi::Runtime& rt) {
      return rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(expression), "test.js").toString(rt).utf8(rt);
    });
  }

  /// What a Host posts JS tasks with.
  JsPoster poster() {
    return [this](JsTask task) {
      post([this, task = std::move(task)] {
        if (runtime_) task(*runtime_);
      });
    };
  }

  /// Destroys the runtime on the JS thread, as a reload does: after what
  /// is queued, or before it (and resuming a paused thread) if `first`.
  void destroyRuntime(bool first = false) {
    auto done = std::make_shared<std::promise<void>>();
    std::future<void> gone = done->get_future();

    auto destroy = [this, done] {
      runtime_.reset();
      done->set_value();
    };

    if (first) {
      {
        std::lock_guard<std::mutex> g(m_);
        tasks_.push_front(std::move(destroy));
        paused_ = false;
      }

      cv_.notify_all();
    } else {
      post(std::move(destroy));
    }

    gone.get();
  }

  /// While paused, what is posted waits.
  void pause(bool paused) {
    {
      std::lock_guard<std::mutex> g(m_);
      paused_ = paused;
    }

    cv_.notify_all();
  }

  size_t queued() {
    std::lock_guard<std::mutex> g(m_);
    return tasks_.size();
  }

  bool isCurrent() const { return std::this_thread::get_id() == id_; }

  std::thread::id id() const { return id_; }

 private:
  void post(std::function<void()> task) {
    {
      std::lock_guard<std::mutex> g(m_);
      tasks_.push_back(std::move(task));
    }

    cv_.notify_all();
  }

  void loop() {
    id_ = std::this_thread::get_id();
    runtime_ = facebook::hermes::makeHermesRuntime(::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build());

    std::unique_lock<std::mutex> g(m_);
    for (;;) {
      cv_.wait(g, [this] { return stopping_ || (!paused_ && !tasks_.empty()); });
      if (tasks_.empty()) break;

      std::function<void()> task = std::move(tasks_.front());
      tasks_.pop_front();
      g.unlock();

      task();
      task = nullptr;
      if (runtime_) runtime_->drainMicrotasks();

      g.lock();
    }

    g.unlock();
    runtime_.reset();
  }

  std::mutex m_;
  std::condition_variable cv_;
  std::deque<std::function<void()>> tasks_;
  bool paused_ = false;
  bool stopping_ = false;

  std::unique_ptr<jsi::Runtime> runtime_;
  std::thread::id id_;
  std::thread thread_;
};

/// The host Host::get finds for `js`'s runtime, or null.
static Host* current(JsThread& js) {
  return js.run([](jsi::Runtime& rt) -> Host* {
    try {
      return &Host::get(rt);
    } catch (const jsi::JSError&) {
      return nullptr;
    }
  });
}

/// A Host on `js`, with its modules on `globalThis.mods`.
static std::shared_ptr<Host> install(JsThread& js) {
  return js.run([&](jsi::Runtime& rt) {
    auto host = Host::create(rt, js.poster());
    rt.global().setProperty(rt, "mods", host->modules(rt));
    return host;
  });
}

// --- the module ---------------------------------------------------------------

namespace m_t {

double value(double x) { return x * 2; }

/// Where the values Lucent produced were released.
struct Releases {
  std::atomic<int> count{0};
  std::atomic<int> onLucentThread{0};

  void reset() {
    count = 0;
    onLucentThread = 0;
  }
};

Releases releases;

/// A value that records where it was released.
struct Payload : Object {
  explicit Payload(double v) : value(v) {}

  ~Payload() override {
    if (Actor::shared().onActorThread()) releases.onLucentThread++;
    releases.count++;
  }

  double value;
};

/// What later() waits for; the test opens it.
Promise<void> gate;
std::atomic<int> started{0};

Promise<Ref<Payload>> later(double x) {
  started++;
  co_await gate;
  co_return std::make_shared<Payload>(x);
}

/// What awaitJs saw of the JS promise it awaited (written holding the
/// Lucent lock, read once `awaitedDone` counts it).
std::string awaited;
std::atomic<int> awaitedDone{0};

Promise<void> awaitJs(Promise<double> p) {
  try {
    double v = co_await p;
    awaited = "value " + std::to_string(v);
  } catch (const Exception& e) {
    awaited = e.error()->name.toUtf8() + ": " + e.error()->message.toUtf8();
  }

  awaitedDone++;
}

/// A JS function kept for later, and what calling it gave.
Opt<Fn<Promise<double>()>> kept;
std::string answered;
std::atomic<int> answeredDone{0};

void keep(Fn<Promise<double>()> f) { kept = f; }

Promise<void> callKept() {
  Fn<Promise<double>()> f = kept.get();

  try {
    double v = co_await f();
    answered = "value " + std::to_string(v);
  } catch (const Exception& e) {
    answered = e.error()->name.toUtf8() + ": " + e.error()->message.toUtf8();
  }

  answeredDone++;
}

/// Where platform objects were released.
std::atomic<int> handlesReleased{0};
std::atomic<int> handlesReleasedOnMain{0};

void releaseHandle(void* p) {
  delete static_cast<int*>(p);
  if (onMainThread()) handlesReleasedOnMain++;
  handlesReleased++;
}

/// A class instance holding a platform object that must be released on the
/// main thread, as a UIKit object must.
struct Handle : Object {
  NativeRef ref{new int(0), releaseHandle, nullptr, &ExecutionContext::main()};
  double pings = 0;

  double ping() { return ++pings; }
};

Ref<Handle> handle() { return std::make_shared<Handle>(); }

/// Module state every runtime reaches (guarded by the Lucent lock).
Ref<Handle> shared;

Ref<Handle> sharedHandle() {
  if (!shared) shared = handle();
  return shared;
}

/// A long async function that yields between slices with `delay(0)`,
/// until stopped; `spun` counts its turns.
std::atomic<bool> stopSpinning{false};
std::atomic<int> spun{0};

Promise<void> spin() {
  while (!stopSpinning) {
    auto until = std::chrono::steady_clock::now() + std::chrono::microseconds(200);
    while (std::chrono::steady_clock::now() < until) {
    }

    spun++;
    co_await delay(0);
  }
}

/// Work module code starts for a runtime that a reload must stop: a
/// callback composition, a subscription and a native operation, each with
/// a cleanup, and a loop of timers (`ticker`).
std::atomic<int> workCleanups{0};
std::atomic<int> workAborted{0};
std::atomic<int> ticks{0};
std::atomic<int> tickerEnded{0};

template <class T>
void countAbort(const Promise<T>& p) {
  p.onSettled([p] {
    if (!p.fulfilled() && p.error()->name.toUtf8() == "AbortError") workAborted++;
  });
}

void listen() {
  using Resolve = Fn<void(double)>;
  using Reject = Fn<void(Error)>;
  using Next = Fn<void(double)>;

  countAbort(fromCallback<double>(Fn<Fn<void()>(Resolve, Reject)>([](Resolve, Reject) { return Fn<void()>([] { workCleanups++; }); })));
  countAbort(subscribe(Fn<Fn<void()>(Next, Fn<void()>, Fn<void(Error)>)>(
                           [](Next, Fn<void()>, Fn<void(Error)>) { return Fn<void()>([] { workCleanups++; }); }),
                       [](double) {}));
  countAbort(nativeOperation<double>([](const std::shared_ptr<Operation<double>>&) -> std::function<void()> {
    return [] { workCleanups++; };
  }));
}

Promise<void> ticker() {
  try {
    for (;;) {
      co_await delay(2);
      ticks++;
    }
  } catch (const Exception&) {
    tickerEnded++;
  }
}

/// A value whose conversion to JavaScript throws a Lucent error (not a
/// jsi::JSError), as a struct converter's checks can.
struct Unconvertible : Object {};

Promise<Ref<Unconvertible>> unconvertible() {
  co_await delay(0);
  co_return std::make_shared<Unconvertible>();
}

/// A void JS callback, called from the Lucent thread with an argument whose
/// conversion throws.
Fn<void(Ref<Unconvertible>)> told;

void tell(Fn<void(Ref<Unconvertible>)> f) {
  told = f;
  Actor::shared().post([] { told(std::make_shared<Unconvertible>()); });
}

/// Traced exports, as the compiler emits them: with their .lucent.ts site.
double measured(double x) {
  LUCENT_TRACE_SCOPE("measured.work");
  return x + 1;
}

Promise<double> measuredLater(double x) {
  co_await delay(1);
  co_return x * 2;
}

/// The runtime that work module code starts now belongs to.
double scopeRuntime() { return static_cast<double>(moduleScope()->runtime()); }

/// Calls `f` now, as module code calls a JavaScript callback.
void callBack(Fn<void()> f) { f(); }

/// A module constant as the compiler generates one that is not a literal:
/// storage that init() assigns, and assigns again for each new runtime.
String label;
std::atomic<int> initialized{0};

/// What the destroy hooks init() registers saw: the label of the state they ended.
std::atomic<int> destroyed{0};
String destroyedLabel;
std::atomic<int> unregistered{0};

void init() {
  label = String::fromUtf8("a label init() computes, too long to fit inline");
  initialized++;
  int generation = initialized;
  onDestroy(Fn<void()>([generation] {
    destroyed++;
    destroyedLabel = String::fromUtf8(label.toUtf8() + " " + std::to_string(generation));
  }));
  // A hook removed before its state ends never runs.
  Fn<void()> stop = onDestroy(Fn<void()>([] { unregistered++; }));
  stop();
}

/// Compute tasks, as the compiler lowers one that reads a literal module
/// constant: the literal is in the task's own code, which reads no module
/// storage. An input of 0 loops until the task is cancelled.
std::atomic<int> tasksRunning{0};
std::atomic<double> lastTotal{0};

double measure(std::tuple<double>&& input, TaskContext& task_) {
  tasksRunning++;

  struct Stopped {
    ~Stopped() { tasksRunning--; }
  } stopped;

  double n = std::get<0>(input);
  double total = 0;

  for (double i = 0; n == 0 || i < n; i++) {
    task_.checkCancelled();
    total += static_cast<double>(LUCENT_STR("a literal module constant, copied into the task").length());
  }

  lastTotal = total;
  return total;
}

constexpr TaskEntry<std::tuple<double>, double> measureEntry{"t.measure", &measure};

/// Submits a task as compiled code does: under the module scope, from the
/// JS thread holding the Lucent lock.
void startMeasure(double n) {
  LucentScope scope;
  (void)compute(measureEntry, std::tuple<double>{n}, ComputeOptions{Opt<AbortSignal>(), moduleScope()});
}

/// An emitter module code keeps, whose listeners JavaScript adds.
using TickEvents = EventEmitterObject<Fn<void(double)>>;
Ref<TickEvents> tickEvents = TickEvents::create({"tick"});

}  // namespace m_t

namespace lucent::js {

template <>
struct Convert<Ref<m_t::Payload>> {
  static jsi::Value toJs(jsi::Runtime&, Host&, const Ref<m_t::Payload>& v) { return jsi::Value(v->value); }
};

void handleProto(jsi::Runtime& rt, Host& host, jsi::Object& proto);

template <>
struct Convert<Ref<m_t::Unconvertible>> {
  static jsi::Value toJs(jsi::Runtime&, Host&, const Ref<m_t::Unconvertible>&) { throwTypeError("cannot cross"); }
};

template <>
struct Convert<Ref<m_t::Handle>> {
  static Ref<m_t::Handle> fromJs(jsi::Runtime& rt, const jsi::Value& v, const Path& p) {
    auto h = std::dynamic_pointer_cast<m_t::Handle>(instanceOf(rt, v));
    if (!h) throwBoundaryError(rt, p, "a Handle", v);
    return h;
  }

  static jsi::Value toJs(jsi::Runtime& rt, Host& h, const Ref<m_t::Handle>& v) { return h.wrap(rt, v, "t.Handle", handleProto); }
};

void handleProto(jsi::Runtime& rt, Host& host, jsi::Object& proto) {
  defineFunction(rt, proto, "ping", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value& self, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     auto h = Convert<Ref<m_t::Handle>>::fromJs(rt, self, Path{"Handle.ping", "this"});
                     return Convert<double>::toJs(rt, host, h->ping());
                   });
                 });
}

}  // namespace lucent::js

namespace {

void installRuntimes(jsi::Runtime& rt, Host& host, jsi::Object& exports);

void installT(jsi::Runtime& rt, Host& host, jsi::Object& exports) {
  installRuntimes(rt, host, exports);

  defineFunction(rt, exports, "measured", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, LUCENT_TRACE_SITE_AT("measured", "/app/src/stats.lucent.ts", 12), [&] {
                     double x = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"measured", "argument 'x'"});
                     return Convert<double>::toJs(rt, host, m_t::measured(x));
                   });
                 });

  defineFunction(rt, exports, "measuredLater", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     double x = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"measuredLater", "argument 'x'"});
                     return callAsync<double>(rt, host, LUCENT_TRACE_SITE_AT("measuredLater", "/app/src/stats.lucent.ts", 20),
                                              [x] { return m_t::measuredLater(x); });
                   });
                 });

  defineFunction(rt, exports, "value", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     double x = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"value", "argument 'x'"});
                     return Convert<double>::toJs(rt, host, m_t::value(x));
                   });
                 });

  defineFunction(rt, exports, "later", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     double x = Convert<double>::fromJs(rt, arg(args, n, 0), Path{"later", "argument 'x'"});
                     return callAsync<Ref<m_t::Payload>>(rt, host, [x] { return m_t::later(x); });
                   });
                 });

  defineFunction(rt, exports, "awaitJs", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     auto p = Convert<Promise<double>>::fromJs(rt, arg(args, n, 0), Path{"awaitJs", "argument 'p'"});
                     return callAsync<void>(rt, host, [p] { return m_t::awaitJs(p); });
                   });
                 });

  defineFunction(rt, exports, "handle", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return Convert<Ref<m_t::Handle>>::toJs(rt, host, m_t::handle()); });
                 });

  defineFunction(rt, exports, "sharedHandle", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return Convert<Ref<m_t::Handle>>::toJs(rt, host, m_t::sharedHandle()); });
                 });

  defineFunction(rt, exports, "spin", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return callAsync<void>(rt, host, [] { return m_t::spin(); }); });
                 });

  defineFunction(rt, exports, "tickEvents", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return Convert<Ref<m_t::TickEvents>>::toJs(rt, host, m_t::tickEvents); });
                 });

  defineFunction(rt, exports, "listen", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     m_t::listen();
                     return jsi::Value::undefined();
                   });
                 });

  defineFunction(rt, exports, "ticker", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return callAsync<void>(rt, host, [] { return m_t::ticker(); }); });
                 });

  defineFunction(rt, exports, "unconvertible", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return callAsync<Ref<m_t::Unconvertible>>(rt, host, [] { return m_t::unconvertible(); }); });
                 });

  defineFunction(rt, exports, "tell", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     m_t::tell(Convert<Fn<void(Ref<m_t::Unconvertible>)>>::fromJs(rt, arg(args, n, 0), Path{"tell", "argument 'f'"}));
                     return jsi::Value::undefined();
                   });
                 });

  defineFunction(rt, exports, "keep", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     auto f = Convert<Fn<Promise<double>()>>::fromJs(rt, arg(args, n, 0), Path{"keep", "argument 'f'"});
                     m_t::keep(f);
                     return jsi::Value::undefined();
                   });
                 });
}

void installRuntimes(jsi::Runtime& rt, Host& host, jsi::Object& exports) {
  defineFunction(rt, exports, "scopeRuntime", 0,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] { return jsi::Value(m_t::scopeRuntime()); });
                 });

  defineFunction(rt, exports, "callBack", 1,
                 [installed = host.shared_from_this()](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t n) {
                   Host& host = Host::from(rt, installed);
                   return callSync(rt, host, [&] {
                     m_t::callBack(Convert<Fn<void()>>::fromJs(rt, arg(args, n, 0), Path{"callBack", "argument 'f'"}));
                     return jsi::Value::undefined();
                   });
                 });
}

const ModuleDef kModules[] = {{"t", installT}};

}  // namespace

namespace lucent::js {

const ModuleDef* registeredModules(size_t& count) {
  count = sizeof(kModules) / sizeof(kModules[0]);
  return kModules;
}

void resetModuleState() { m_t::init(); }

jsi::Value errorInstanceToJs(jsi::Runtime&, Host&, const Error&) { return jsi::Value::undefined(); }

const BuildIdentity& buildIdentity() {
  static const ModuleIdentity modules[] = {{"t", "api-of-t"}};
  static const BuildIdentity identity{"all", "program-of-t", modules, 1};
  return identity;
}

}  // namespace lucent::js

// --- hosts --------------------------------------------------------------------

/// Each runtime has a host of its own, with an id no other host has had,
/// and destroying one runtime leaves the other's working.
static void runtimesHaveTheirOwnHosts() {
  JsThread a, b;
  auto hostA = install(a);
  auto hostB = install(b);

  CHECK(hostA->id() != 0 && hostB->id() != 0 && hostA->id() != hostB->id());
  CHECK(current(a) == hostA.get() && current(b) == hostB.get());

  CHECK(a.number("mods.t.value(2)") == 4);
  CHECK(b.number("mods.t.value(3)") == 6);

  a.destroyRuntime();

  CHECK(!hostA->alive() && hostB->alive());
  CHECK(b.number("mods.t.value(4)") == 8);
  CHECK(current(b) == hostB.get());

  // A new runtime (a reload) gets a new host, with a new id.
  JsThread c;
  auto hostC = install(c);

  CHECK(hostC->id() != hostA->id() && hostC->id() != hostB->id());
  CHECK(c.number("mods.t.value(5)") == 10);
}

/// A new host for a runtime replaces the one it had: that one is torn down,
/// and tearing it down again leaves the new one registered. JavaScript that
/// kept the old host's exports reaches the new host.
static void newHostsReplaceOldOnes() {
  JsThread js;
  auto first = install(js);

  js.eval("var old = mods.t;");

  auto second = js.run([&](jsi::Runtime& rt) { return Host::create(rt, js.poster()); });

  CHECK(!first->alive() && second->alive());
  CHECK(second->id() != first->id());

  js.run([&](jsi::Runtime&) { first->invalidate(); });

  CHECK(current(js) == second.get());
  CHECK(js.number("(() => { try { return old.value(21); } catch (e) { return -1; } })()") == 42);
}

/// Module code's work (compute tasks) belongs to the scope of the runtime its
/// modules run for: the newest host's, disposed when that host is torn down.
static void theNewestHostOwnsModuleWork() {
  JsThread js;
  auto first = install(js);

  CHECK(moduleScope() == first->scope());

  auto second = js.run([&](jsi::Runtime& rt) { return Host::create(rt, js.poster()); });

  // Disposed on the module context, soon after.
  auto disposed = [](const std::shared_ptr<Host>& host) {
    return within(2000, [&] { return host->scope()->state() == Scope::State::Disposed; });
  };

  CHECK(moduleScope() == second->scope());
  CHECK(disposed(first));

  js.run([&](jsi::Runtime&) { second->invalidate(); });

  CHECK(moduleScope() == second->scope() && disposed(second));
}

static void connectSettle(JsThread& js, const std::shared_ptr<Host>& host);

/// Two runtimes at once (two React Native instances): the second's host
/// leaves the module state the first uses as it is, the work each one's
/// calls start belongs to it, view requests are answered in the runtime
/// that sent them, and tearing one down spares the other's work.
static void twoRuntimesKeepTheirOwnWork() {
  JsThread a, b;
  int before = m_t::initialized;

  auto hostA = install(a);
  auto hostB = install(b);

  // Initialized for the first, not again under it for the second.
  CHECK(m_t::initialized == before + 1);

  CHECK(a.number("mods.t.scopeRuntime()") == hostA->id());
  CHECK(b.number("mods.t.scopeRuntime()") == hostB->id());

  connectSettle(a, hostA);
  connectSettle(b, hostB);

  // Whichever runtime connected last, an id answers in its own.
  double idA = views::requestBase(hostA->id()) + 1;
  double idB = views::requestBase(hostB->id()) + 1;
  views::Requester::current().resolve(idA, [](jsi::Runtime&) { return jsi::Value(1); });
  views::Requester::current().resolve(idB, [](jsi::Runtime&) { return jsi::Value(2); });

  CHECK(within(2000, [&] { return a.number("settled.length") == 1 && b.number("settled.length") == 1; }));
  CHECK(a.number("settled[0][0]") == idA && a.number("settled[0][2]") == 1);
  CHECK(b.number("settled[0][0]") == idB && b.number("settled[0][2]") == 2);

  // The second runtime goes: the first's work goes on, its own.
  b.destroyRuntime();

  CHECK(hostA->alive() && !hostB->alive());
  CHECK(hostA->scope()->state() == Scope::State::Active);
  CHECK(a.number("mods.t.scopeRuntime()") == hostA->id());
  CHECK(moduleScope() == hostA->scope());

  // An answer for the gone runtime goes nowhere.
  views::Requester::current().resolve(idB + 1, [](jsi::Runtime&) { return jsi::Value(3); });

  // A third runtime while the first is there shares its module state too.
  JsThread c;
  auto hostC = install(c);
  CHECK(m_t::initialized == before + 1);
  CHECK(c.number("mods.t.scopeRuntime()") == hostC->id() && a.number("mods.t.scopeRuntime()") == hostA->id());
}

/// The suspected deadlock, through JSI: a synchronous call whose JavaScript
/// callback waits for the main thread (as RCTUnsafeExecuteOnMainQueueSync
/// does), while the main thread enters the module for a delegate that must
/// answer. The callback lends the module's actor to the main thread.
static void aCallbackWaitingForMainLendsTheModule() {
  JsThread js;
  install(js);
  std::atomic<bool> delegateRan{false};

  js.run([&](jsi::Runtime& rt) {
    auto wait = [&](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
      std::promise<void> done;
      auto answered = done.get_future();

      postToMain([&] {
        callNow([&] { delegateRan = Actor::shared().lock().heldByCurrentThread(); });
        done.set_value();
      });

      if (answered.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
        std::fprintf(stderr, "deadlock: the main thread's delegate did not run within 5 s\n");
        std::fflush(stderr);
        std::_Exit(2);
      }

      return jsi::Value::undefined();
    };
    rt.global().setProperty(rt, "waitForMain",
                            jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, "waitForMain"), 0, wait));
  });

  js.eval("mods.t.callBack(() => waitForMain())");
  CHECK(delegateRan.load());
}

/// A reload assigns module constants again while the old runtime's compute
/// tasks still run on workers. The tasks read only what their code holds,
/// stop at their next safepoint, and a task of the new runtime runs to its
/// end. Under TSan, a task that read the module's storage instead is a
/// data race with init().
static void tasksRunningAcrossAReloadReadNoModuleStorage() {
  JsThread js;
  install(js);

  int before = m_t::initialized;

  js.run([](jsi::Runtime&) {
    for (int i = 0; i < 3; i++) m_t::startMeasure(0);
  });
  // As many as the shared pool runs at once (one worker on a two-core machine).
  const int running = static_cast<int>(std::min<size_t>(3, ComputePool::shared()->workers()));
  CHECK(within(2000, [&] { return m_t::tasksRunning.load() == running; }));

  for (int reload = 0; reload < 20; reload++) install(js);

  CHECK(m_t::initialized == before + 20);
  CHECK(within(2000, [] { return m_t::tasksRunning.load() == 0; }));

  m_t::lastTotal = 0;
  js.run([](jsi::Runtime&) { m_t::startMeasure(10); });

  double expected = 10.0 * static_cast<double>(LUCENT_STR("a literal module constant, copied into the task").length());

  CHECK(within(2000, [&] { return m_t::lastTotal.load() == expected; }));
  CHECK(within(2000, [] { return m_t::tasksRunning.load() == 0; }));
}

// --- build identity -------------------------------------------------------------

/// What JavaScript checks its proxies against: the runtime's ABI, the
/// program and module APIs the generated code was built as, and the host
/// that answers, a new one after a reload.
static void hostsTellTheirBuildIdentity() {
  JsThread a;
  auto first = install(a);

  CHECK(a.number("mods.__lucentIdentity.runtimeAbi") == kRuntimeAbi);
  CHECK(a.number("mods.__lucentIdentity.host") == static_cast<double>(first->id()));
  CHECK(a.string("mods.__lucentIdentity.target") == "all");
  CHECK(a.string("mods.__lucentIdentity.program") == "program-of-t");
  CHECK(a.string("JSON.stringify(mods.__lucentIdentity.modules)") == R"({"t":"api-of-t"})");

  // As React Native's TurboModule asks for it: a property of the module object.
  CHECK(a.run([&](jsi::Runtime& rt) {
    return first->module(rt, "__lucentIdentity").asObject(rt).getProperty(rt, "program").asString(rt).utf8(rt);
  }) == "program-of-t");

  a.destroyRuntime();

  JsThread b;
  auto second = install(b);

  CHECK(b.number("mods.__lucentIdentity.host") == static_cast<double>(second->id()));
  CHECK(second->id() != first->id());
}

// --- teardown -------------------------------------------------------------------

/// A new gate for later() to wait for.
static void newGate() {
  LucentScope scope;
  m_t::gate = Promise<void>();
}

/// Lets what waits for the gate go on (settled on the module context).
static void openGate() { m_t::gate.resolve(undefined); }

/// Tearing a host down while its runtime is usable rejects the promises
/// JavaScript still waits for. A result that arrives later is not
/// delivered: it is released on the module context.
static void pendingPromisesRejectWhileJsIsAlive() {
  JsThread js;
  auto host = install(js);
  newGate();
  m_t::releases.reset();
  int before = m_t::started;

  js.eval("var outcome = 'pending'; mods.t.later(1).then(v => { outcome = 'value ' + v; }, e => { outcome = e.name + ': ' + e.message; });");
  CHECK(within(2000, [&] { return m_t::started == before + 1; }));

  js.run([&](jsi::Runtime&) { host->invalidate(); });

  CHECK(js.string("outcome") == "AbortError: Lucent was torn down for this JavaScript runtime");

  openGate();

  CHECK(within(2000, [&] { return m_t::releases.count == 1; }));
  CHECK(m_t::releases.onLucentThread == 1);
}

/// A reload with work in flight: the runtime goes while the result it was
/// sent waits on the JS thread. The result is released on the module
/// context, not on the thread that dropped it.
static void resultsForAGoneRuntimeAreReleasedOnTheModuleContext() {
  JsThread js;
  auto host = install(js);
  newGate();
  m_t::releases.reset();
  int before = m_t::started;

  js.eval("mods.t.later(2);");
  CHECK(within(2000, [&] { return m_t::started == before + 1; }));

  js.pause(true);
  openGate();
  CHECK(within(2000, [&] { return js.queued() == 1; }));

  js.destroyRuntime(true);

  CHECK(!host->alive());
  CHECK(within(2000, [&] { return m_t::releases.count == 1; }));
  CHECK(m_t::releases.onLucentThread == 1);
}

/// Work a host posted to the module context does not start once the host
/// is torn down.
static void workDoesNotStartAfterTeardown() {
  JsThread js;
  auto host = install(js);
  newGate();
  int before = m_t::started;

  js.run([&](jsi::Runtime& rt) {
    // Holding the Lucent lock, so the job cannot start before the teardown.
    LucentScope scope;
    rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>("mods.t.later(3).catch(() => {});"), "test.js");
    host->invalidate();
  });

  CHECK(Actor::shared().waitIdle(2000));
  CHECK(m_t::started == before);

  openGate();
}

/// Lucent code awaiting a JS promise when its runtime goes: the await
/// rejects, so the code goes on and releases what it holds.
static void awaitedJsPromisesRejectAtTeardown() {
  JsThread js;
  auto host = install(js);
  int before = m_t::awaitedDone;

  js.eval("mods.t.awaitJs(new Promise(() => {}));");
  CHECK(Actor::shared().waitIdle(2000));

  js.destroyRuntime();

  CHECK(within(2000, [&] { return m_t::awaitedDone == before + 1; }));
  CHECK(m_t::awaited == "AbortError: The JavaScript runtime is gone");
}

/// A JS callback that returns a promise, called as its runtime goes: its
/// promise rejects instead of never settling, as it does when called
/// after the runtime has gone.
static void callbacksDroppedWithTheRuntimeReject() {
  JsThread js;
  auto host = install(js);
  int before = m_t::answeredDone;

  js.eval("mods.t.keep(() => Promise.resolve(7));");

  js.pause(true);
  Actor::shared().post([] { m_t::callKept(); });
  CHECK(within(2000, [&] { return js.queued() == 1; }));

  js.destroyRuntime(true);

  CHECK(within(2000, [&] { return m_t::answeredDone == before + 1; }));
  CHECK(m_t::answered == "AbortError: The JavaScript runtime is gone");

  Actor::shared().post([] { m_t::callKept(); });

  CHECK(within(2000, [&] { return m_t::answeredDone == before + 2; }));
  CHECK(m_t::answered == "AbortError: The JavaScript runtime is gone");

  LucentScope scope;
  m_t::kept = undefined;
}

// --- module hooks -------------------------------------------------------------

/// Module code's destroy hooks run when its state ends: before a reload
/// initializes it again (seeing the state they belong to), and when the
/// runtime goes.
static void destroyHooksRunWhenModuleStateEnds() {
  JsThread js;
  install(js);
  int before = m_t::destroyed;
  int generation = m_t::initialized;

  install(js);
  CHECK(m_t::destroyed == before + 1);
  CHECK(m_t::destroyedLabel.toUtf8() == "a label init() computes, too long to fit inline " + std::to_string(generation));

  js.destroyRuntime();
  CHECK(within(2000, [&] { return m_t::destroyed == before + 2; }));
  CHECK(m_t::unregistered == 0);
}

// --- events -------------------------------------------------------------------

/// A listener JavaScript added belongs to its runtime: after a reload,
/// module code no longer counts or calls it, and the new runtime's work.
static void listenersEndWithTheirRuntime() {
  JsThread js;
  install(js);

  js.eval("var got = []; mods.t.tickEvents().addListener('tick', (n) => got.push(n));");
  {
    LucentScope scope;
    CHECK(m_t::tickEvents->listenerCount(0) == 1);
    m_t::tickEvents->emit<0>(1.0);
  }
  CHECK(js.string("got.join()") == "1");
  CHECK(js.string("mods.t.tickEvents() === mods.t.tickEvents()") == "true");
  CHECK(js.string("(() => { try { mods.t.tickEvents().addListener('tock', () => {}); } catch (e) { return e.message; } })()") ==
        "EventEmitter.addListener: unknown event \"tock\" (\"tick\")");

  // A reload: the runtime gets a new host.
  js.run([&](jsi::Runtime& rt) { Host::create(rt, js.poster()); });
  {
    LucentScope scope;
    CHECK(m_t::tickEvents->listenerCount(0) == 0);
    m_t::tickEvents->emit<0>(2.0);
  }
  CHECK(js.string("got.join()") == "1");

  js.eval("mods.t.tickEvents().addListener('tick', (n) => got.push(n));");
  {
    LucentScope scope;
    CHECK(m_t::tickEvents->listenerCount(0) == 1);
    m_t::tickEvents->emit<0>(3.0);
    m_t::tickEvents->removeAllListeners();
  }
  CHECK(js.string("got.join()") == "1,3");
}

/// A reload (a new host for the runtime, or the runtime's end) stops what
/// module code started for it: compositions, subscriptions and native
/// operations cancel and run their cleanups, and timers stop.
static void reloadsStopModuleWork() {
  for (bool destroy : {false, true}) {
    JsThread js;
    install(js);
    m_t::workCleanups = 0;
    m_t::workAborted = 0;
    m_t::ticks = 0;
    m_t::tickerEnded = 0;

    js.eval("mods.t.listen(); mods.t.ticker().catch(() => {});");
    CHECK(within(2000, [] { return m_t::ticks.load() > 3; }));
    CHECK(m_t::workCleanups == 0 && m_t::workAborted == 0);

    if (destroy) {
      js.destroyRuntime();
    } else {
      install(js);
    }

    CHECK(within(2000, [] { return m_t::workCleanups.load() == 3; }));
    CHECK(within(2000, [] { return m_t::workAborted.load() == 3; }));
    CHECK(within(2000, [] { return m_t::tickerEnded.load() == 1; }));

    int at = m_t::ticks;
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    CHECK(m_t::ticks == at);
  }
}

/// A result that cannot cross to JavaScript, whatever it throws, rejects
/// the promise JavaScript waits for; a void callback's arguments that
/// cannot cross are reported. Neither escapes the JS thread's task.
static void resultsThatCannotCrossReject() {
  JsThread js;
  install(js);

  js.eval("var crossed = 'pending'; mods.t.unconvertible().then(() => { crossed = 'resolved'; }, (e) => { crossed = e.name + ': ' + e.message; });");
  CHECK(within(2000, [&] { return js.string("crossed") != "pending"; }));
  CHECK(js.string("crossed") == "TypeError: cannot cross");

  js.eval("var calls = 0; mods.t.tell(() => { calls++; });");
  CHECK(Actor::shared().waitIdle(2000));
  js.run([](jsi::Runtime&) {});
  CHECK(js.number("calls") == 0);
  CHECK(js.number("1 + 1") == 2);

  LucentScope scope;
  m_t::told = {};
}

// --- instances ----------------------------------------------------------------

/// One native instance reached from two runtimes: each has its own JS
/// object for it, the same one every time it crosses there.
static void eachRuntimeHasItsOwnObjectForAnInstance() {
  JsThread a, b;
  install(a);
  install(b);

  a.eval("var mine = mods.t.sharedHandle();");
  b.eval("var mine = mods.t.sharedHandle();");

  CHECK(a.string("mine === mods.t.sharedHandle()") == "true");
  CHECK(b.string("mine === mods.t.sharedHandle()") == "true");

  double first = a.number("mine.ping()");
  CHECK(b.number("mine.ping()") == first + 1);

  LucentScope scope;
  m_t::shared = nullptr;
}

/// Objects a torn-down host gave JavaScript are refused by its successor:
/// they belong to state that host's teardown ended. New ones work.
static void objectsOfATornDownHostAreRefused() {
  JsThread js;
  install(js);

  js.eval("var old = mods.t.handle(); old.ping();");

  js.run([&](jsi::Runtime& rt) { Host::create(rt, js.poster()); });

  CHECK(js.string("(() => { try { old.ping(); return 'accepted'; } catch (e) { return e.name + ': ' + e.message; } })()") ==
        "TypeError: This Lucent object belongs to a host that was torn down");
  CHECK(js.number("mods.t.handle().ping()") == 1);
}

/// The JS thread collects the last JS object for an instance; the platform
/// object it held is released on the main thread. And the same when the
/// runtime itself goes.
static void collectedInstancesReleaseOnTheirThread() {
  JsThread js;
  install(js);
  int before = m_t::handlesReleased;

  js.eval("(function () { mods.t.handle().ping(); })();");
  js.run([](jsi::Runtime& rt) { rt.instrumentation().collectGarbage("test"); });

  CHECK(within(2000, [&] { return m_t::handlesReleased == before + 1; }));
  CHECK(m_t::handlesReleasedOnMain == before + 1);

  js.eval("var kept = mods.t.handle();");
  js.destroyRuntime();

  CHECK(within(2000, [&] { return m_t::handlesReleased == before + 2; }));
  CHECK(m_t::handlesReleasedOnMain == before + 2);
}

// --- ownership evidence -----------------------------------------------------------

/// A host reports what it holds, in C++ and, in debug builds, to
/// JavaScript; once torn down it holds nothing.
static void hostsReportWhatTheyHold() {
  JsThread js;
  auto host = install(js);
  newGate();

  auto held = [&] { return js.run([&](jsi::Runtime&) { return host->ownership(); }); };
  Host::Ownership empty = held();

  CHECK(empty.runtime == host->id());
  CHECK(empty.promises == 0 && empty.callbacks == 0 && empty.identities == 0);
  CHECK(empty.modules == 1 && empty.registrations == 0);

  js.eval(
      "var handle = mods.t.handle();"
      "mods.t.keep(() => Promise.resolve(1));"
      "mods.t.later(1).catch(() => {});"
      "mods.t.awaitJs(new Promise(() => {})).catch(() => {});");
  CHECK(Actor::shared().waitIdle(2000));

  Host::Ownership busy = held();

  CHECK(busy.promises == 2);
  CHECK(busy.callbacks == 1);
  CHECK(busy.identities == 1 && busy.prototypes == 1);
  CHECK(busy.registrations == 1);
  CHECK(busy.inFlight == 0);

  CHECK(js.string("JSON.stringify(__lucentHost.ownership)") ==
        "{\"runtime\":" + std::to_string(host->id()) +
            ",\"promises\":2,\"callbacks\":1,\"identities\":1,\"prototypes\":1,\"modules\":1,\"registrations\":1,\"inFlight\":0}");

  js.run([&](jsi::Runtime&) { host->invalidate(); });
  CHECK(Actor::shared().waitIdle(2000));

  Host::Ownership gone = held();

  CHECK(gone.promises == 0 && gone.callbacks == 0 && gone.identities == 0);
  CHECK(gone.prototypes == 0 && gone.modules == 0 && gone.registrations == 0);
  CHECK(gone.inFlight == 0);

  openGate();

  LucentScope scope;
  m_t::kept = undefined;
}

/// A debug build's snapshot (__lucentDebug.snapshot()): a promise, settled
/// on the JS thread, of what the runtime owns live, its live mounts, and
/// what the host holds for JavaScript.
static void debugSnapshotsSettleOnTheJsThread() {
  JsThread js;
  auto host = install(js);

  js.eval("var snap; __lucentDebug.snapshot().then((s) => { snap = s; });");

  CHECK(within(2000, [&] { return js.string("typeof snap") == "object"; }));
  CHECK(js.string("JSON.stringify(Object.keys(snap))") == "[\"resources\",\"mounts\",\"host\"]");
  CHECK(js.string("typeof snap.resources.scopes") == "number");
  CHECK(js.string("JSON.stringify(snap.mounts)") == "[]");
  CHECK(js.number("snap.host.modules") == 1);
  CHECK(js.number("snap.host.runtime") == static_cast<double>(host->id()));
}

/// Tasks for the JS thread count, from any thread, until they run or are
/// released.
static void tasksInFlightAreCounted() {
  JsThread js;
  auto host = install(js);

  js.pause(true);
  host->postToJs([](jsi::Runtime&) {});
  CHECK(host->inFlight() == 1);

  js.destroyRuntime(true);

  CHECK(within(2000, [&] { return host->inFlight() == 0; }));
}

// --- the Lucent lock ----------------------------------------------------------

/// While a Lucent loop yields with `delay(0)`, the JS thread's calls into
/// module code (a timer tick calling a sync export) each get in within
/// about one of its turns.
static void jsCallsEnterWhileALoopYields() {
  JsThread js;
  auto host = install(js);

  m_t::stopSpinning = false;
  m_t::spun = 0;
  js.eval("globalThis.spinning = mods.t.spin();");
  CHECK(within(2000, [&] { return m_t::spun.load() > 10; }));

  double longest = 0;
  auto start = Clock::now();

  for (int tick = 0; tick < 50; tick++) {
    // The JS thread's own work between timer ticks.
    std::this_thread::sleep_for(std::chrono::milliseconds(1));

    auto asked = Clock::now();
    CHECK(js.number("mods.t.value(21)") == 42);
    longest = std::max(longest, std::chrono::duration<double, std::milli>(Clock::now() - asked).count());
  }

  double total = std::chrono::duration<double, std::milli>(Clock::now() - start).count();

  m_t::stopSpinning = true;
  CHECK(within(2000, [&] { return Actor::shared().pendingWork() == 0; }));

  std::printf("host: 50 JS ticks against a yielding loop took %.1f ms, the longest call %.2f ms\n", total, longest);
  CHECK(longest < 50);
  CHECK(total < 1000);
}

// --- tracing --------------------------------------------------------------------

static std::vector<trace::Event> named(const std::vector<trace::Event>& events, const char* name) {
  std::vector<trace::Event> out;
  for (const auto& e : events) {
    if (std::strcmp(e.name, name) == 0) out.push_back(e);
  }
  return out;
}

/// A JS call into a traced export is an entry span at the export's
/// .lucent.ts site, with the native work it did inside it.
static void syncCallsTraceTheirEntry() {
  JsThread js;
  auto host = install(js);

  trace::start();
  CHECK(js.number("mods.t.measured(1)") == 2);
  std::vector<trace::Event> events = trace::events();
  trace::stop();

  std::vector<trace::Event> entries = named(events, "measured");
  CHECK(entries.size() == 1);
  CHECK(!entries.empty() && entries[0].category == trace::Category::Entry);
  CHECK(!entries.empty() && entries[0].site && std::string(entries[0].site->file) == "/app/src/stats.lucent.ts" &&
        entries[0].site->line == 12);

  // The work ran inside the call.
  std::vector<trace::Event> work = named(events, "measured.work");
  CHECK(work.size() == 1);
  CHECK(!work.empty() && !entries.empty() && work[0].startNs >= entries[0].startNs &&
        work[0].startNs + work[0].durationNs <= entries[0].startNs + entries[0].durationNs);
}

/// An async export's call, the job it posted (its wait and its run), and
/// the delivery of its result on the JS thread share one id.
static void asyncCallsCorrelateToTheirCompletion() {
  JsThread js;
  auto host = install(js);

  trace::start();
  js.eval("globalThis.answer = 0; mods.t.measuredLater(4).then(function (v) { globalThis.answer = v; });");
  CHECK(within(2000, [&] { return js.number("globalThis.answer") == 8; }));
  std::vector<trace::Event> events = trace::events();
  trace::stop();

  // The entry and the delivery both carry the export's name.
  std::vector<trace::Event> entries = named(events, "measuredLater");
  std::erase_if(entries, [](const trace::Event& e) { return e.category != trace::Category::Entry; });
  CHECK(entries.size() == 1);

  uint64_t id = entries.empty() ? 0 : entries[0].id;
  CHECK(id != 0);

  auto has = [&](trace::Category c, const char* name) {
    return std::any_of(events.begin(), events.end(),
                       [&](const trace::Event& e) { return e.id == id && e.category == c && std::strcmp(e.name, name) == 0; });
  };

  CHECK(has(trace::Category::Entry, "measuredLater"));
  CHECK(has(trace::Category::Queue, "wait"));
  CHECK(has(trace::Category::Run, "run"));
  CHECK(has(trace::Category::Queue, "js.wait"));
  CHECK(has(trace::Category::Completion, "measuredLater"));
}

// --- view requests ----------------------------------------------------------------

/// Connects a runtime's settle function for view requests: it records each
/// call as `[id, error, value]` in `settled`.
static void connectSettle(JsThread& js, const std::shared_ptr<Host>& host) {
  js.run([&](jsi::Runtime& rt) {
    rt.evaluateJavaScript(
        std::make_shared<jsi::StringBuffer>(
            "var settled = []; var settle = (id, error, value) => settled.push([id, error, value]);"),
        "test.js");
    views::connectRequests(host, rt, rt.global().getPropertyAsFunction(rt, "settle"));
  });
}

/// A request is answered in the runtime whose view sent the command, on its
/// JS thread, from any thread: resolved with a value built there, or
/// rejected with a message.
static void viewRequestsAnswerOnTheirJsThread() {
  JsThread js;
  auto host = install(js);

  connectSettle(js, host);

  auto requester = views::Requester::current();

  CHECK(static_cast<bool>(requester));

  // Recorded there and checked here: CHECK's counters belong to this thread.
  std::atomic<bool> builtOnJs{false};

  std::thread([&] {
    requester.resolve(1, [&](jsi::Runtime&) {
      builtOnJs = js.isCurrent();
      return jsi::Value(42);
    });
    requester.reject(2, "the view went away");
  }).join();

  CHECK(within(2000, [&] { return js.number("settled.length") == 2; }));
  CHECK(js.string("JSON.stringify(settled)") == "[[1,null,42],[2,\"the view went away\",null]]");
  CHECK(builtOnJs);
}

/// After a reload, answers to the old runtime's requests go nowhere: not to
/// the new runtime, whose request ids start again.
static void viewRequestsOfAGoneRuntimeAreDropped() {
  JsThread js;
  auto first = install(js);

  connectSettle(js, first);

  auto old = views::Requester::current();
  auto second = js.run([&](jsi::Runtime& rt) { return Host::create(rt, js.poster()); });

  connectSettle(js, second);
  js.run([&](jsi::Runtime&) { first->invalidate(); });

  old.resolve(1, [](jsi::Runtime&) { return jsi::Value(1); });
  views::Requester::current().resolve(2, [](jsi::Runtime&) { return jsi::Value(2); });

  CHECK(within(2000, [&] { return js.number("settled.length") == 1; }));
  CHECK(js.string("JSON.stringify(settled)") == "[[2,null,2]]");

  CHECK(!old && static_cast<bool>(views::Requester::current()));
}

/// A mount's answers reach JavaScript only while its view holds that
/// mount: once the view holds another (recycled or remounted, a view or a
/// tag reused), an answer is dropped at once, with what it carries.
static void viewAnswersFollowTheirMount() {
  JsThread js;
  auto host = install(js);

  connectSettle(js, host);

  struct HostView {
    std::shared_ptr<bool> holds;

    bool current() const { return *holds; }
  };

  auto holds = std::make_shared<bool>(true);
  auto respond = views::answerTo(HostView{holds}, views::Requester::current());

  respond(views::Answer{1, std::nullopt, [](jsi::Runtime&) { return jsi::Value(1); }});
  respond(views::Answer{2, std::string("no tickets left"), {}});

  // The view holds another mount now.
  *holds = false;

  auto carried = std::make_shared<int>(0);

  respond(views::Answer{3, std::nullopt, [carried](jsi::Runtime&) { return jsi::Value(3); }});

  CHECK(carried.use_count() == 1);
  CHECK(within(2000, [&] { return js.number("settled.length") == 2; }));

  std::this_thread::sleep_for(std::chrono::milliseconds(50));

  CHECK(js.string("JSON.stringify(settled)") == "[[1,null,1],[2,\"no tickets left\",null]]");
}

/// An answer for a torn-down runtime's request never runs, and what it
/// carries is released (on the module context, as the host releases every
/// task it drops).
static void viewAnswersOfAGoneRuntimeReleaseWhatTheyCarry() {
  JsThread js;
  auto host = install(js);

  connectSettle(js, host);

  auto requester = views::Requester::current();

  js.run([&](jsi::Runtime&) { host->invalidate(); });

  auto carried = std::make_shared<int>(0);
  std::atomic<bool> ran{false};

  requester.resolve(1, [carried, &ran](jsi::Runtime&) {
    ran = true;
    return jsi::Value(1);
  });
  requester.reject(2, "late");

  CHECK(within(2000, [&] { return carried.use_count() == 1; }));
  CHECK(!ran);
  CHECK(js.number("settled.length") == 0);
}

int main() {
  runtimesHaveTheirOwnHosts();
  newHostsReplaceOldOnes();
  hostsTellTheirBuildIdentity();
  theNewestHostOwnsModuleWork();
  tasksRunningAcrossAReloadReadNoModuleStorage();
  twoRuntimesKeepTheirOwnWork();
  aCallbackWaitingForMainLendsTheModule();
  pendingPromisesRejectWhileJsIsAlive();
  resultsForAGoneRuntimeAreReleasedOnTheModuleContext();
  workDoesNotStartAfterTeardown();
  awaitedJsPromisesRejectAtTeardown();
  callbacksDroppedWithTheRuntimeReject();
  destroyHooksRunWhenModuleStateEnds();
  listenersEndWithTheirRuntime();
  reloadsStopModuleWork();
  resultsThatCannotCrossReject();
  eachRuntimeHasItsOwnObjectForAnInstance();
  objectsOfATornDownHostAreRefused();
  collectedInstancesReleaseOnTheirThread();
  hostsReportWhatTheyHold();
  debugSnapshotsSettleOnTheJsThread();
  tasksInFlightAreCounted();
  syncCallsTraceTheirEntry();
  asyncCallsCorrelateToTheirCompletion();
  jsCallsEnterWhileALoopYields();
  viewRequestsAnswerOnTheirJsThread();
  viewRequestsOfAGoneRuntimeAreDropped();
  viewAnswersFollowTheirMount();
  viewAnswersOfAGoneRuntimeReleaseWhatTheyCarry();

  std::printf("host: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
