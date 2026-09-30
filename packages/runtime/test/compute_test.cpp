// Unit tests for isolated compute: copying a task's input (lucent/transport.h)
// and the bounded pool that runs tasks for their owners (lucent/compute.h).
// Built and run by `packages/runtime/test/run.sh`, also under ASan/UBSan and
// TSan. With LUCENT_COMPUTE_BENCH=1 it also prints the submit-to-complete
// latency and the cost of a safepoint (build with -O2 for numbers).
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <tuple>
#include <typeinfo>
#include <variant>
#include <vector>

#include "lucent/compute.h"
#include "lucent/lucent.h"
#include "lucent/transport.h"

using namespace lucent;

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

static String str(const char* s) { return String::fromUtf8(s); }

/// The name of the Lucent error `f` throws, or "" if it throws none.
template <class F>
static std::string thrownName(F f) {
  try {
    f();
  } catch (const Exception& e) {
    return e.error()->name.toUtf8();
  }

  return "";
}

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

/// Runs `f` as a turn of `context` and returns its result. The test thread
/// is in no context, so it may wait.
template <class F>
static auto inside(ExecutionContext& context, F f) -> decltype(f()) {
  using R = decltype(f());
  std::promise<R> result;
  auto future = result.get_future();

  context.post([&] {
    if constexpr (std::is_void_v<R>) {
      f();
      result.set_value();
    } else {
      result.set_value(f());
    }
  });

  if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    std::fprintf(stderr, "a turn did not run within 5 s\n");
    std::abort();
  }

  return future.get();
}

/// What a promise made on `owner` settled with, seen from the test thread.
template <class T>
struct Watched {
  std::atomic<int> settled{0};
  std::atomic<bool> fulfilled{false};
  std::atomic<bool> onOwner{false};
  /// Written before `settled`.
  std::string error;
  std::string message;
  detail::Stored<T> value{};
};

/// Calls `submit` in a turn of `owner` and watches the promise it returns.
template <class T, class Submit>
static std::shared_ptr<Watched<T>> watch(ExecutionContext& owner, Submit submit) {
  auto watched = std::make_shared<Watched<T>>();

  inside(owner, [&] {
    Promise<T> promise = submit();

    promise.onSettled([watched, promise, &owner] {
      watched->onOwner = owner.isCurrent();

      if (promise.fulfilled()) {
        watched->value = promise.value();
        watched->fulfilled = true;
      } else {
        watched->error = promise.error()->name.toUtf8();
        watched->message = promise.error()->message.toUtf8();
      }

      watched->settled++;
    });
  });

  return watched;
}

template <class T>
static bool settles(const std::shared_ptr<Watched<T>>& watched) {
  return within(5000, [&] { return watched->settled.load() > 0; });
}

/// Holds tasks until opened, and counts those that reached it.
struct Gate {
  std::atomic<bool> open{false};
  std::atomic<int> arrived{0};

  /// Waits, up to 5 s, to be opened; false if it was not.
  bool pass() {
    arrived++;
    return within(5000, [&] { return open.load(); });
  }
};

/// What a task saw while it ran.
struct Spy {
  std::atomic<int> ran{0};
  std::atomic<int> left{0};
  std::atomic<int> cleaned{0};
  std::atomic<ExecutionContext*> context{nullptr};
  std::atomic<ExecutionContext*> cleanedOn{nullptr};
  std::atomic<bool> heldLock{false};
  std::atomic<bool> hadTask{false};
};

/// A result that counts where it was made and released.
struct Probe : Object {
  static inline std::atomic<int> made{0};
  static inline std::atomic<int> released{0};
  static inline std::atomic<ExecutionContext*> releasedOn{nullptr};

  Probe() { made++; }

  ~Probe() override {
    releasedOn = ExecutionContext::current();
    released++;
  }
};

// --- objects, as the compiler emits them ------------------------------------

struct Node : Object {
  double value = 0;
  Opt<Ref<Node>> next;
};

struct Shape : Object {
  double sides = 0;
};

struct Square : Shape {};

/// A native allocation that moves to the task instead of being copied.
struct Owned : Object {
  int payload = 0;
  bool transferred = false;
};

namespace lucent {

template <>
struct Transport<Ref<Node>> {
  static Ref<Node> copy(const Ref<Node>& source, CopyGraph& graph) {
    return transportObject(source, graph, [](const Node& from, Node& to, CopyGraph& g) {
      to.value = from.value;
      to.next = transport(from.next, g);
    });
  }
};

template <>
struct Transport<Ref<Shape>> {
  static Ref<Shape> copy(const Ref<Shape>& source, CopyGraph& graph) {
    return transportObject(source, graph, [](const Shape& from, Shape& to, CopyGraph&) { to.sides = from.sides; });
  }
};

template <>
struct Transport<Ref<Owned>> {
  static Ref<Owned> copy(const Ref<Owned>& source, CopyGraph& graph) {
    if (auto* moved = graph.find<Ref<Owned>>(source.get())) return *moved;

    auto moved = std::make_shared<Owned>();
    moved->payload = source->payload;
    graph.remember(source.get(), moved);

    graph.onCommit([source] { source->transferred = true; }, [moved] { moved->payload = -1; });
    return moved;
  }
};

// Test-only: the gate and spy are shared on purpose, through atomics.
template <>
struct Transport<Gate*> {
  static Gate* copy(Gate* const& gate, CopyGraph&) { return gate; }
};

template <>
struct Transport<Spy*> {
  static Spy* copy(Spy* const& spy, CopyGraph&) { return spy; }
};

}  // namespace lucent

// --- tasks, as the compiler would emit their entries ---------------------------

static double squareRun(std::tuple<double>&& in, TaskContext&) { return std::get<0>(in) * std::get<0>(in); }
static constexpr TaskEntry<std::tuple<double>, double> square{"square", squareRun};

/// Records where it runs, and registers a cleanup on the task's scope.
static double observeRun(std::tuple<Spy*>&& in, TaskContext& task) {
  Spy* spy = std::get<0>(in);

  spy->context = ExecutionContext::current();
  spy->heldLock = Scheduler::lock().heldByCurrentThread();
  spy->hadTask = TaskContext::current() == &task;
  spy->ran++;

  task.scope()->onDispose([spy] {
    spy->cleanedOn = ExecutionContext::current();
    spy->cleaned++;
  });

  return 1;
}
static constexpr TaskEntry<std::tuple<Spy*>, double> observe{"observe", observeRun};

/// Waits at the gate, then returns 1 (0 if the gate never opened).
static double waitRun(std::tuple<Gate*>&& in, TaskContext&) { return std::get<0>(in)->pass() ? 1 : 0; }
static constexpr TaskEntry<std::tuple<Gate*>, double> waitAtGate{"waitAtGate", waitRun};

/// Arrives, then waits (up to 5 s) for `count` tasks to arrive.
static double meetRun(std::tuple<Gate*, double>&& in, TaskContext&) {
  auto [gate, count] = in;
  gate->arrived++;

  return within(5000, [&] { return gate->arrived.load() >= count; }) ? 1 : 0;
}
static constexpr TaskEntry<std::tuple<Gate*, double>, double> meet{"meet", meetRun};

/// Spins at a safepoint until cancelled (or 5 s pass).
static double spinRun(std::tuple<Gate*, Spy*>&& in, TaskContext& task) {
  auto [gate, spy] = in;

  struct Leave {
    Spy* spy;
    ~Leave() { spy->left++; }
  } leave{spy};

  spy->ran++;
  gate->arrived++;

  auto deadline = Clock::now() + std::chrono::seconds(5);
  while (Clock::now() < deadline) {
    task.checkCancelled();
    std::this_thread::sleep_for(std::chrono::microseconds(200));
  }

  return 0;
}
static constexpr TaskEntry<std::tuple<Gate*, Spy*>, double> spin{"spin", spinRun};

/// Waits at the gate, then makes a probe.
static Ref<Probe> probeRun(std::tuple<Gate*>&& in, TaskContext&) {
  std::get<0>(in)->pass();
  return std::make_shared<Probe>();
}
static constexpr TaskEntry<std::tuple<Gate*>, Ref<Probe>> makeProbe{"makeProbe", probeRun};

/// Busy for about `micros`, then makes a probe.
static Ref<Probe> probeSoonRun(std::tuple<double>&& in, TaskContext&) {
  auto until = Clock::now() + std::chrono::microseconds(static_cast<int64_t>(std::get<0>(in)));
  while (Clock::now() < until) {
  }

  return std::make_shared<Probe>();
}
static constexpr TaskEntry<std::tuple<double>, Ref<Probe>> probeSoon{"probeSoon", probeSoonRun};

/// Sums its input after the gate opens, and changes it.
static double sumRun(std::tuple<Gate*, Array<double>>&& in, TaskContext&) {
  auto& [gate, values] = in;
  gate->pass();

  double sum = 0;
  for (double v : values.items()) sum += v;

  values.push(100);
  return sum;
}
static constexpr TaskEntry<std::tuple<Gate*, Array<double>>, double> sumAfterGate{"sum", sumRun};

static double throwRun(std::tuple<double>&& in, TaskContext&) {
  if (std::get<0>(in) == 0) throwError(String::fromLatin1("TypeError"), String::fromLatin1("bad input"));

  throw std::runtime_error("native failure");
}
static constexpr TaskEntry<std::tuple<double>, double> fail{"fail", throwRun};

static void nothingRun(std::tuple<Spy*>&& in, TaskContext&) { std::get<0>(in)->ran++; }
static constexpr TaskEntry<std::tuple<Spy*>, void> nothing{"nothing", nothingRun};

static double shapeRun(std::tuple<Ref<Shape>>&& in, TaskContext&) { return std::get<0>(in)->sides; }
static constexpr TaskEntry<std::tuple<Ref<Shape>>, double> sides{"sides", shapeRun};

// --- transport ----------------------------------------------------------------

static void primitivesAndStringsCrossAsTheyAre() {
  auto [n, b, s, u] = transportCopy(std::make_tuple(1.5, true, str("héllo"), undefined));

  CHECK(n == 1.5);
  CHECK(b);
  CHECK(s == str("héllo"));
  CHECK(u == undefined);
}

static void copiesAreIndependentOfTheirSource() {
  Array<double> source{1, 2, 3};

  Array<double> copy = transportCopy(source);
  source.set(0, 10);
  copy.push(4);

  CHECK(!strictEquals(copy, source));
  CHECK(copy.join() == str("1,2,3,4"));
  CHECK(source.join() == str("10,2,3"));
}

static void aliasesStayOneObject() {
  Array<double> shared{1, 2};
  Array<Array<double>> outer{shared, shared, Array<double>{3}};

  auto [a, b, nested] = transportCopy(std::make_tuple(shared, shared, outer));

  CHECK(strictEquals(a, b));
  CHECK(!strictEquals(a, shared));
  CHECK(strictEquals(nested.at(0), a) && strictEquals(nested.at(1), a));
  CHECK(!strictEquals(nested.at(2), a));

  a.push(9);
  CHECK(nested.at(1).join() == str("1,2,9"));
  CHECK(shared.join() == str("1,2"));
}

static void collectionsKeepTheirOrderAndAliases() {
  Array<double> values{7};
  Map<String, Array<double>> map;
  map.set(str("b"), values).set(str("a"), values);

  auto point = std::make_shared<Node>();
  Set<Ref<Node>> set;
  set.add(point);

  Dict<Array<double>> dict;
  dict.set(str("x"), values);

  auto [m, s, d, p] = transportCopy(std::make_tuple(map, set, dict, point));

  CHECK(m.keys().join() == str("b,a"));
  CHECK(strictEquals(m.get(str("a")).get(), m.get(str("b")).get()));
  CHECK(strictEquals(m.get(str("a")).get(), d.get(str("x")).get()));
  CHECK(!strictEquals(d.get(str("x")).get(), values));

  CHECK(s.size() == 1 && s.has(p) && !s.has(point));
  CHECK(p != point);
}

static void byteViewsShareTheirCopiedBuffer() {
  Bytes whole = Bytes::fromArray(Array<double>{0, 1, 2, 3, 4, 5});
  Bytes middle = whole.subarray(2, 5);

  auto [w, m, again] = transportCopy(std::make_tuple(whole, middle, middle));

  CHECK(m.join() == str("2,3,4"));
  CHECK(strictEquals(m, again));

  w.set(3, 99);
  CHECK(m.at(1) == 99);
  CHECK(middle.at(1) == 3);
  CHECK(w.data() != whole.data());
}

static void objectGraphsKeepTheirCycles() {
  auto a = std::make_shared<Node>();
  auto b = std::make_shared<Node>();
  a->value = 1;
  a->next = b;
  b->value = 2;
  b->next = a;

  Ref<Node> copy = transportCopy(a);

  CHECK(copy != a && copy->value == 1);
  CHECK(copy->next.get()->value == 2 && copy->next.get() != b);
  CHECK(copy->next.get()->next.get() == copy);

  // Cycles are copied, but not collected: break them.
  a->next = undefined;
  copy->next.get()->next = undefined;
}

static void optionalsAndUnionsCopyWhatTheyHold() {
  using Value = Union<double, Array<double>, String>;
  Array<double> list{4};

  auto [none, nothing, some, number, array] =
      transportCopy(std::make_tuple(Opt<Array<double>>(null), Opt<Array<double>>(), Opt<Array<double>>(list), Value(2.0), Value(list)));

  CHECK(none.isNull() && nothing.isUndefined());
  CHECK(some.has() && some.get().join() == str("4") && !strictEquals(some.get(), list));
  CHECK(std::get<double>(number) == 2);
  CHECK(strictEquals(std::get<Array<double>>(array), some.get()));
}

static void datesAreCopied() {
  Date when = makeDate(1000);

  auto [a, b] = transportCopy(std::make_tuple(when, when));

  CHECK(a != when && a == b);
  CHECK(a->getTime() == 1000);
}

static void aSubclassIsRefused() {
  Ref<Shape> square = std::make_shared<Square>();
  Ref<Shape> shape = std::make_shared<Shape>();

  CHECK(thrownName([&] { transportCopy(square); }) == "DataCloneError");
  CHECK(thrownName([&] { transportCopy(shape); }).empty());
}

static void unsupportedTypesDoNotCompile() {
  static_assert(Transportable<Array<Dict<Opt<String>>>>);
  static_assert(Transportable<std::tuple<Bytes, Map<double, Set<String>>, Union<bool, Null>>>);
  static_assert(Transportable<Ref<Node>>);

  static_assert(!Transportable<Fn<double(double)>>);
  static_assert(!Transportable<Promise<double>>);
  static_assert(!Transportable<AbortSignal>);
  static_assert(!Transportable<Array<Fn<void()>>>);
  static_assert(!Transportable<Ref<Square>>);

  CHECK(true);
}

static void movesCommitOnlyOnceTheGraphIsComplete() {
  auto owned = std::make_shared<Owned>();
  owned->payload = 5;
  Ref<Shape> square = std::make_shared<Square>();

  CHECK(thrownName([&] { transportCopy(std::make_tuple(owned, square)); }) == "DataCloneError");
  CHECK(!owned->transferred);

  auto [a, b] = transportCopy(std::make_tuple(owned, owned));

  CHECK(owned->transferred);
  CHECK(a == b && a != owned && a->payload == 5);
}


// --- the pool -------------------------------------------------------------------

static void resultsReturnToTheOwner() {
  auto owner = IsolatedContext::create();
  Spy spy;

  auto squared = watch<double>(*owner, [] { return compute(square, std::make_tuple(3.0)); });
  auto observed = watch<double>(*owner, [&] { return compute(observe, std::make_tuple(&spy)); });

  CHECK(settles(squared) && settles(observed));
  CHECK(squared->fulfilled && squared->value == 9 && squared->onOwner);
  CHECK(observed->fulfilled && observed->onOwner);

  ExecutionContext* worker = spy.context;
  CHECK(worker && worker != owner.get() && worker != &ExecutionContext::legacy() && worker != &ExecutionContext::main());
  CHECK(!spy.heldLock && spy.hadTask);

  // The task's scope ended on its worker before the result left it.
  CHECK(spy.cleaned == 1 && spy.cleanedOn == worker);

  // From module code, the result comes back to the module context.
  auto fromModule = watch<double>(ExecutionContext::legacy(), [] { return compute(square, std::make_tuple(4.0)); });
  CHECK(settles(fromModule));
  CHECK(fromModule->fulfilled && fromModule->value == 16 && fromModule->onOwner);

  owner->shutdown();
}

static void independentJobsRunInParallel() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 4, .capacity = 8});
  Gate gate;
  std::vector<std::shared_ptr<Watched<double>>> jobs;

  for (int i = 0; i < 4; i++) {
    jobs.push_back(watch<double>(*owner, [&] { return compute(meet, std::make_tuple(&gate, 4.0), {.pool = pool}); }));
  }

  for (auto& job : jobs) CHECK(settles(job) && job->fulfilled && job->value == 1);

  ComputeStats stats = pool->stats();
  CHECK(stats.workers == 4 && stats.peakRunning == 4);
  CHECK(stats.submitted == 4 && stats.finished == 4 && stats.saturated == 0);

  pool->shutdown();
  owner->shutdown();
}

static void aFullQueueRejectsWithoutBlocking() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 2});
  Gate gate;

  auto running = watch<double>(*owner, [&] { return compute(waitAtGate, std::make_tuple(&gate), {.pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  auto first = watch<double>(*owner, [&] { return compute(waitAtGate, std::make_tuple(&gate), {.pool = pool}); });
  auto second = watch<double>(*owner, [&] { return compute(waitAtGate, std::make_tuple(&gate), {.pool = pool}); });
  auto refused = watch<double>(*owner, [&] { return compute(waitAtGate, std::make_tuple(&gate), {.pool = pool}); });

  // Refused at once, while every worker is busy and the queue full.
  CHECK(settles(refused) && refused->error == "QuotaExceededError" && refused->onOwner);
  CHECK(running->settled == 0 && first->settled == 0 && second->settled == 0);

  ComputeStats stats = pool->stats();
  CHECK(stats.queued == 2 && stats.running == 1 && stats.capacity == 2);
  CHECK(stats.submitted == 4 && stats.rejected == 1 && stats.saturated == 2 && stats.peakQueued == 2);

  gate.open = true;

  CHECK(settles(running) && settles(first) && settles(second));
  CHECK(running->fulfilled && first->fulfilled && second->fulfilled);
  CHECK(gate.arrived == 3);

  pool->shutdown();
  owner->shutdown();
}

static void cancellingBeforeTheStartLeavesTheQueue() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 1});
  Gate gate;
  Spy spy;

  auto running = watch<double>(*owner, [&] { return compute(waitAtGate, std::make_tuple(&gate), {.pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  AbortController controller = inside(*owner, [] { return std::make_shared<AbortControllerObject>(); });
  auto queued = watch<double>(*owner, [&] { return compute(observe, std::make_tuple(&spy), {.signal = controller->signal, .pool = pool}); });
  CHECK(pool->stats().queued == 1);

  inside(*owner, [&] { controller->abort(makeError(str("AbortError"), str("not needed"))); });

  CHECK(settles(queued) && queued->error == "AbortError" && queued->message == "not needed");

  ComputeStats stats = pool->stats();
  CHECK(stats.queued == 0 && stats.cancelledQueued == 1);

  // Its place is free again.
  auto next = watch<double>(*owner, [&] { return compute(square, std::make_tuple(5.0), {.pool = pool}); });

  gate.open = true;

  CHECK(settles(running) && settles(next) && next->value == 25);
  CHECK(spy.ran == 0);

  pool->shutdown();
  owner->shutdown();
}

static void cancellingARunningTaskStopsItAtASafepoint() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 1});
  Gate gate;
  Spy spy;

  AbortController controller = inside(*owner, [] { return std::make_shared<AbortControllerObject>(); });
  auto spinning = watch<double>(*owner, [&] { return compute(spin, std::make_tuple(&gate, &spy), {.signal = controller->signal, .pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  // Aborted from another thread: posted to the signal's owner.
  controller->abort(makeError(str("AbortError"), str("stop")));

  CHECK(settles(spinning) && spinning->error == "AbortError" && spinning->message == "stop");
  CHECK(within(2000, [&] { return spy.left.load() == 1; }));
  CHECK(within(2000, [&] { return pool->stats().abandoned == 1; }));
  CHECK(pool->stats().running == 0);

  pool->shutdown();
  owner->shutdown();
}

static void anAbortedSignalSubmitsNothing() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1});
  Spy spy;

  AbortController controller = inside(*owner, [] {
    auto made = std::make_shared<AbortControllerObject>();
    made->abort(undefined);
    return made;
  });

  auto aborted = watch<double>(*owner, [&] { return compute(observe, std::make_tuple(&spy), {.signal = controller->signal, .pool = pool}); });

  CHECK(settles(aborted) && aborted->error == "AbortError");
  CHECK(pool->stats().submitted == 0 && spy.ran == 0);

  pool->shutdown();
  owner->shutdown();
}

static void cancelAndCompleteSettleOnce() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 2});
  int made = Probe::made;
  int released = Probe::released;
  int fulfilled = 0;

  for (int round = 0; round < 200; round++) {
    AbortController controller = inside(*owner, [] { return std::make_shared<AbortControllerObject>(); });
    auto raced = watch<Ref<Probe>>(*owner, [&] { return compute(probeSoon, std::make_tuple(100.0), {.signal = controller->signal, .pool = pool}); });

    // Sooner or later than the task completes, round by round.
    std::thread([controller, round] {
      std::this_thread::sleep_for(std::chrono::microseconds(round % 10 * 20));
      controller->abort(undefined);
    }).join();

    CHECK(settles(raced));
    CHECK(raced->fulfilled != (raced->error == "AbortError"));

    fulfilled += raced->fulfilled ? 1 : 0;
    raced->value = nullptr;
  }

  CHECK(owner->waitIdle(2000));
  CHECK(pool->stats().running == 0 && pool->stats().queued == 0);

  // Every result was released, delivered or not.
  CHECK(within(2000, [&] { return Probe::made - made == Probe::released - released; }));
  std::printf("compute: cancel-vs-complete, %d of 200 completed first\n", fulfilled);

  pool->shutdown();
  owner->shutdown();
}

static void taskErrorsRejectThePromise() {
  auto owner = IsolatedContext::create();

  auto thrown = watch<double>(*owner, [] { return compute(fail, std::make_tuple(0.0)); });
  auto native = watch<double>(*owner, [] { return compute(fail, std::make_tuple(1.0)); });

  CHECK(settles(thrown) && thrown->error == "TypeError" && thrown->message == "bad input" && thrown->onOwner);
  CHECK(settles(native) && native->error == "Error" && native->message == "native failure");

  // An input that cannot be copied is refused before it is submitted.
  Ref<Shape> square = std::make_shared<Square>();
  auto refused = watch<double>(*owner, [&] { return compute(sides, std::make_tuple(square)); });
  CHECK(settles(refused) && refused->error == "DataCloneError");

  owner->shutdown();
}

static void voidTasksFulfil() {
  auto owner = IsolatedContext::create();
  Spy spy;

  auto done = watch<void>(*owner, [&] { return compute(nothing, std::make_tuple(&spy)); });

  CHECK(settles(done) && done->fulfilled && spy.ran == 1);

  owner->shutdown();
}

static void inputsAreSnapshots() {
  auto owner = IsolatedContext::create();
  Gate gate;
  Array<double> values{1, 2, 3};

  auto summed = watch<double>(*owner, [&] { return compute(sumAfterGate, std::make_tuple(&gate, values)); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  inside(*owner, [&] { values.set(0, 10); });
  gate.open = true;

  CHECK(settles(summed) && summed->value == 6);
  CHECK(inside(*owner, [&] { return values.join(); }) == str("10,2,3"));

  owner->shutdown();
}

static void aDisposedScopeReleasesTheResult() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1});
  Gate gate;
  int released = Probe::released;

  auto scope = inside(*owner, [&] { return Scope::create(0, owner->root()); });
  auto disposed = watch<Ref<Probe>>(*owner, [&] { return compute(makeProbe, std::make_tuple(&gate), {.scope = scope, .pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  inside(*owner, [&] { scope->dispose(); });

  // Rejected at once, while the task still runs.
  CHECK(settles(disposed) && disposed->error == "AbortError");

  gate.open = true;

  CHECK(within(2000, [&] { return Probe::released.load() == released + 1; }));
  CHECK(within(2000, [&] { return pool->stats().abandoned == 1; }));
  CHECK(disposed->settled == 1 && !disposed->fulfilled);

  // Released on the worker, never delivered to the owner.
  ExecutionContext* on = Probe::releasedOn;
  CHECK(on && on != owner.get() && on != &ExecutionContext::legacy());

  pool->shutdown();
  owner->shutdown();
}

/// Module code submits tasks under the scope of the JavaScript runtime its
/// modules run for: tearing that runtime down (a reload) cancels them, and
/// its code starts no more.
static void tasksBelongToTheModuleScope() {
  // No runtime attached: the legacy module context's root.
  CHECK(moduleScope() == ExecutionContext::legacy().root());

  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1});
  Gate gate;
  int released = Probe::released;

  auto runtime = inside(*owner, [&] { return Scope::create(0, owner->root()); });
  setModuleScope(runtime);
  CHECK(moduleScope() == runtime);

  auto running = watch<Ref<Probe>>(*owner, [&] { return compute(makeProbe, std::make_tuple(&gate), {.scope = moduleScope(), .pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  inside(*owner, [&] { runtime->dispose(); });

  CHECK(settles(running) && running->error == "AbortError");

  gate.open = true;

  CHECK(within(2000, [&] { return Probe::released.load() == released + 1; }));
  CHECK(within(2000, [&] { return pool->stats().running == 0; }));

  // The torn-down runtime's scope stays the module scope until another
  // runtime replaces it: nothing more starts for it.
  Spy spy;
  auto late = watch<double>(*owner, [&] { return compute(observe, std::make_tuple(&spy), {.scope = moduleScope(), .pool = pool}); });

  CHECK(settles(late) && late->error == "AbortError" && spy.ran == 0);

  setModuleScope(nullptr);
  CHECK(moduleScope() == ExecutionContext::legacy().root());

  pool->shutdown();
  owner->shutdown();
}

static void anOwnerShutDownDropsTheResult() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1});
  Gate gate;
  int released = Probe::released;

  auto dropped = watch<Ref<Probe>>(*owner, [&] { return compute(makeProbe, std::make_tuple(&gate), {.pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  owner->shutdown();
  CHECK(owner->waitStopped(2000));

  gate.open = true;

  CHECK(within(2000, [&] { return Probe::released.load() == released + 1; }));
  CHECK(within(2000, [&] { return pool->stats().running == 0; }));

  // Rejected in the owner's last turn, when it disposed its root.
  CHECK(dropped->settled == 1 && dropped->error == "AbortError");

  pool->shutdown();
}

static void shutdownSettlesEveryTask() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 4});
  Gate gate;
  Spy spinner;
  Spy waiter;

  auto spinning = watch<double>(*owner, [&] { return compute(spin, std::make_tuple(&gate, &spinner), {.pool = pool}); });
  CHECK(within(2000, [&] { return gate.arrived.load() == 1; }));

  auto queued = watch<double>(*owner, [&] { return compute(observe, std::make_tuple(&waiter), {.pool = pool}); });

  pool->shutdown();

  CHECK(settles(spinning) && spinning->error == "AbortError");
  CHECK(settles(queued) && queued->error == "AbortError");
  CHECK(spinning->message == "The compute pool shut down");

  auto late = watch<double>(*owner, [&] { return compute(square, std::make_tuple(1.0), {.pool = pool}); });
  CHECK(settles(late) && late->error == "InvalidStateError");

  CHECK(pool->waitStopped(2000));
  CHECK(spinner.left == 1 && waiter.ran == 0);

  owner->shutdown();
}

static void computingIgnoresModuleAndUiSerialization() {
  auto owner = IsolatedContext::create();

  // Shared with the blocking jobs, which own it: a job may still be
  // running when this frame ends (a failed check returns early).
  struct Blockers {
    std::atomic<bool> release{false};
    std::atomic<bool> locked{false};
    std::atomic<bool> mainBusy{false};
    std::atomic<bool> mainLeft{false};
  };
  auto blockers = std::make_shared<Blockers>();

  // Module code holds the Lucent lock, and the UI loop is busy.
  std::thread module([blockers] {
    LucentScope scope;
    blockers->locked = true;
    within(5000, [&] { return blockers->release.load(); });
  });

  ExecutionContext::main().post([blockers] {
    blockers->mainBusy = true;
    within(5000, [&] { return blockers->release.load(); });
    blockers->mainLeft = true;
  });

  CHECK(within(2000, [&] { return blockers->locked && blockers->mainBusy; }));

  Spy spy;
  auto computed = watch<double>(*owner, [&] { return compute(observe, std::make_tuple(&spy)); });

  CHECK(settles(computed) && computed->fulfilled && !spy.heldLock);

  blockers->release = true;
  module.join();

  // The UI loop is free again before the next test uses it.
  CHECK(within(2000, [&] { return blockers->mainLeft.load(); }));

  owner->shutdown();
}

static void timingsAreOptIn() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1});
  std::mutex m;
  std::vector<TaskTiming> timings;
  Gate gate;

  auto untimed = watch<double>(*owner, [&] { return compute(square, std::make_tuple(2.0), {.pool = pool}); });
  CHECK(settles(untimed));

  pool->setTimingSink([&](const TaskTiming& timing) {
    std::lock_guard<std::mutex> g(m);
    timings.push_back(timing);
  });

  auto first = watch<double>(*owner, [&] { return compute(waitAtGate, std::make_tuple(&gate), {.pool = pool}); });
  auto second = watch<double>(*owner, [&] { return compute(square, std::make_tuple(3.0), {.pool = pool}); });

  std::this_thread::sleep_for(std::chrono::milliseconds(20));
  gate.open = true;

  CHECK(settles(first) && settles(second));
  CHECK(within(2000, [&] {
    std::lock_guard<std::mutex> g(m);
    return timings.size() == 2;
  }));

  std::lock_guard<std::mutex> g(m);
  auto byName = [&](const char* name) {
    return *std::find_if(timings.begin(), timings.end(), [&](const TaskTiming& t) { return std::string(t.entry) == name; });
  };

  TaskTiming waited = byName("waitAtGate");
  TaskTiming queued = byName("square");

  CHECK(waited.outcome == OperationState::Succeeded && waited.started);
  CHECK(waited.ran >= std::chrono::milliseconds(15));
  CHECK(queued.outcome == OperationState::Succeeded && queued.waited >= std::chrono::milliseconds(15));
  CHECK(queued.delivered.count() >= 0 && queued.admitted.count() >= 0);

  ComputeStats stats = pool->stats();
  CHECK(stats.submitted == 3 && stats.started == 3 && stats.finished == 3 && stats.saturated == 1);

  pool->shutdown();
  owner->shutdown();
}

static void theSharedPoolIsBounded() {
  const auto& pool = ComputePool::shared();
  unsigned cores = std::thread::hardware_concurrency();
  size_t expected = cores > 2 ? cores - 1 : 1;

  CHECK(pool == ComputePool::shared());
  CHECK(pool->workers() == expected);
  CHECK(pool->capacity() == ComputePool::kDefaultCapacity);
}

// --- measurements (LUCENT_COMPUTE_BENCH=1) ------------------------------------------

static double loopRun(std::tuple<double, double>&& in, TaskContext& task) {
  auto [iterations, mode] = in;
  double sum = 0;

  for (double i = 0; i < iterations; i++) {
    if (mode == 1) task.checkCancelled();
    if (mode == 2) TaskContext::current()->checkCancelled();

    sum += i;
  }

  return sum;
}
static constexpr TaskEntry<std::tuple<double, double>, double> loop{"loop", loopRun};

static void measure() {
  auto owner = IsolatedContext::create();
  const int rounds = 2000;
  std::atomic<bool> done{false};
  Clock::time_point start;

  // Submit, complete, resume on the owner, then submit the next.
  std::function<void(int)> next = [&](int left) {
    Promise<double> p = compute(square, std::make_tuple(2.0));

    p.onSettled([&, left] {
      if (left > 1) {
        next(left - 1);
      } else {
        done = true;
      }
    });
  };

  inside(*owner, [&] {
    start = Clock::now();
    next(rounds);
  });
  within(30000, [&] { return done.load(); });

  double latency = std::chrono::duration<double, std::micro>(Clock::now() - start).count() / rounds;
  std::printf("bench: submit -> complete -> resume on the owner: %.2f us\n", latency);

  const double iterations = 2e8;
  double ns[3];

  for (int mode = 0; mode < 3; mode++) {
    auto timed = watch<double>(*owner, [&] { return compute(loop, std::make_tuple(iterations, double(mode))); });
    auto t0 = Clock::now();
    within(60000, [&] { return timed->settled.load() > 0; });
    ns[mode] = std::chrono::duration<double, std::nano>(Clock::now() - t0).count() / iterations;
  }

  std::printf("bench: loop %.3f ns/iter; with checkCancelled() %.3f (+%.3f); via TaskContext::current() %.3f (+%.3f)\n", ns[0],
              ns[1], ns[1] - ns[0], ns[2], ns[2] - ns[0]);

  owner->shutdown();
}

int main() {
  primitivesAndStringsCrossAsTheyAre();
  copiesAreIndependentOfTheirSource();
  aliasesStayOneObject();
  collectionsKeepTheirOrderAndAliases();
  byteViewsShareTheirCopiedBuffer();
  objectGraphsKeepTheirCycles();
  optionalsAndUnionsCopyWhatTheyHold();
  datesAreCopied();
  aSubclassIsRefused();
  unsupportedTypesDoNotCompile();
  movesCommitOnlyOnceTheGraphIsComplete();

  resultsReturnToTheOwner();
  independentJobsRunInParallel();
  aFullQueueRejectsWithoutBlocking();
  cancellingBeforeTheStartLeavesTheQueue();
  cancellingARunningTaskStopsItAtASafepoint();
  anAbortedSignalSubmitsNothing();
  cancelAndCompleteSettleOnce();
  taskErrorsRejectThePromise();
  voidTasksFulfil();
  inputsAreSnapshots();
  aDisposedScopeReleasesTheResult();
  tasksBelongToTheModuleScope();
  anOwnerShutDownDropsTheResult();
  shutdownSettlesEveryTask();

  // Each run must leave the Lucent lock and the UI loop as it found them.
  for (int run = 0; run < 20; run++) computingIgnoresModuleAndUiSerialization();

  timingsAreOptIn();
  theSharedPoolIsBounded();

  if (const char* bench = std::getenv("LUCENT_COMPUTE_BENCH"); bench && std::string(bench) == "1") measure();

  std::printf("compute: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
