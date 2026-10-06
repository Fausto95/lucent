// Unit tests for tracing (lucent/trace.h): bounded, correlated events from
// the runtime's own seams (posted jobs, the Lucent lock, compute tasks,
// copies) and from native code with its .lucent.ts source site, exported
// as a Chrome trace. Built and run by `packages/runtime/test/run.sh`, also
// under ASan/UBSan and TSan. With LUCENT_TRACE_OUT=<file> it also writes
// the trace of the three cases it tells apart (a queued job, a compute
// stall, a copy cost); with LUCENT_TRACE_BENCH=1 it prints what the hooks
// cost with tracing off and on (build with -O2).
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <future>
#include <string>
#include <thread>
#include <tuple>
#include <vector>

#include "lucent/buffer.h"
#include "lucent/compute.h"
#include "lucent/lucent.h"
#include "lucent/reactive.h"
#include "lucent/trace.h"
#include "lucent/transport.h"

using namespace lucent;
using trace::Category;
using trace::Event;

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

template <class F>
static bool within(int ms, F done) {
  auto deadline = Clock::now() + std::chrono::milliseconds(ms);

  while (!done()) {
    if (Clock::now() > deadline) return false;

    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  return true;
}

static void busy(int ms) {
  auto until = Clock::now() + std::chrono::milliseconds(ms);
  while (Clock::now() < until) {
  }
}

static constexpr uint64_t kMs = 1000000;

/// The events of `category` named `name`.
static std::vector<Event> find(const std::vector<Event>& events, Category category, const char* name) {
  std::vector<Event> out;

  for (const Event& e : events) {
    if (e.category == category && std::strcmp(e.name, name) == 0) out.push_back(e);
  }

  return out;
}

/// The events correlated by `id`.
static std::vector<Event> correlated(const std::vector<Event>& events, uint64_t id) {
  std::vector<Event> out;

  for (const Event& e : events) {
    if (e.id == id) out.push_back(e);
  }

  return out;
}

// --- recording ----------------------------------------------------------------

static void offByDefaultAndWhenStopped() {
  CHECK(!trace::enabled());

  auto owner = IsolatedContext::create();
  std::atomic<bool> ran{false};
  owner->post([&] { ran = true; });
  CHECK(within(2000, [&] { return ran.load(); }));

  transportCopy(Array<double>{1, 2, 3});
  CHECK(trace::events().empty());

  trace::start();
  CHECK(trace::enabled());

  trace::stop();
  CHECK(!trace::enabled());

  transportCopy(Array<double>{1, 2, 3});
  CHECK(trace::events().empty());

  owner->shutdown();
}

static void theBufferIsBounded() {
  trace::start({.capacity = 8});

  for (int i = 0; i < 20; i++) trace::instant(Category::Native, "tick", 0, i);

  std::vector<Event> events = trace::events();
  trace::stop();

  // The latest eight, oldest first, and a count of what was lost.
  CHECK(events.size() == 8);
  CHECK(!events.empty() && events.front().value == 12 && events.back().value == 19);
  CHECK(trace::dropped() == 12);
}

static void aQueuedJobWaitsOnItsOwner() {
  auto owner = IsolatedContext::create();
  std::atomic<bool> started{false};

  trace::start();

  // The owner is busy; the second job waits for it. The first holds until the second is
  // queued, then works: the wait is its whole 30 ms however late the post comes.
  std::atomic<bool> queued{false};
  owner->post([&] {
    started = true;
    while (!queued.load()) std::this_thread::yield();
    busy(30);
  });
  CHECK(within(2000, [&] { return started.load(); }));

  std::atomic<bool> done{false};
  owner->post([&] { done = true; });
  queued = true;
  CHECK(within(2000, [&] { return done.load(); }));
  CHECK(owner->waitIdle(2000));

  std::vector<Event> events = trace::events();
  trace::stop();

  std::vector<Event> waits = find(events, Category::Queue, "wait");
  std::vector<Event> runs = find(events, Category::Run, "run");
  CHECK(waits.size() == 2 && runs.size() == 2);

  // The second job: a long wait, then a short run, one correlation id.
  auto longest = std::max_element(waits.begin(), waits.end(), [](const Event& a, const Event& b) { return a.durationNs < b.durationNs; });
  CHECK(longest != waits.end() && longest->durationNs >= 20 * kMs);

  std::vector<Event> job = correlated(events, longest->id);
  CHECK(job.size() == 2);
  CHECK(std::any_of(job.begin(), job.end(), [](const Event& e) { return e.category == Category::Run && e.durationNs < 10 * kMs; }));
  CHECK(std::all_of(job.begin(), job.end(), [&](const Event& e) { return e.context == owner->id(); }));

  owner->shutdown();
}

static void lockWaitsAreTheirOwnSpans() {
  std::atomic<bool> holding{false};

  trace::start();

  std::thread holder([&] {
    LucentScope scope;
    holding = true;
    busy(30);
  });
  CHECK(within(2000, [&] { return holding.load(); }));

  // A call into module code from another thread waits for the lock.
  { LucentScope scope; }

  holder.join();

  std::vector<Event> events = trace::events();
  trace::stop();

  std::vector<Event> waits = find(events, Category::Lock, "lucent-lock");
  CHECK(std::any_of(waits.begin(), waits.end(), [](const Event& e) { return e.durationNs >= 15 * kMs; }));
}

// A task that holds its worker.
static double holdRun(std::tuple<double>&& in, TaskContext&) {
  busy(static_cast<int>(std::get<0>(in)));
  return 1;
}
static constexpr TaskEntry<std::tuple<double>, double> hold{"hold", holdRun};

static void aComputeStallWaitsForAWorker() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 4});
  std::atomic<int> settled{0};

  trace::start();

  // The first task holds the only worker; the second waits in the queue.
  owner->post([&] {
    compute(hold, std::make_tuple(40.0), {.pool = pool}).onSettled([&] { settled++; });
    compute(hold, std::make_tuple(1.0), {.pool = pool}).onSettled([&] { settled++; });
  });
  CHECK(within(3000, [&] { return settled.load() == 2; }));
  CHECK(owner->waitIdle(2000));

  std::vector<Event> events = trace::events();
  trace::stop();

  std::vector<Event> waits = find(events, Category::Compute, "compute.wait");
  std::vector<Event> runs = find(events, Category::Compute, "compute.run");
  CHECK(waits.size() == 2 && runs.size() == 2);

  // The stalled task: waited as long as the other ran, then ran briefly.
  auto stalled = std::max_element(waits.begin(), waits.end(), [](const Event& a, const Event& b) { return a.durationNs < b.durationNs; });
  CHECK(stalled != waits.end() && stalled->durationNs >= 30 * kMs);

  std::vector<Event> task = correlated(events, stalled->id);
  CHECK(std::any_of(task.begin(), task.end(), [](const Event& e) { return std::strcmp(e.name, "compute.run") == 0 && e.durationNs < 20 * kMs; }));
  CHECK(std::any_of(task.begin(), task.end(), [](const Event& e) { return std::strcmp(e.name, "compute.deliver") == 0; }));

  // Admitted to a full house: the pool says so.
  CHECK(!find(events, Category::Compute, "compute.saturated").empty());

  pool->shutdown();
  owner->shutdown();
}

static void aLargeCopyShowsItsBytes() {
  Bytes big(8.0 * 1024 * 1024);

  trace::start();
  Bytes copy = transportCopy(big);
  std::vector<Event> events = trace::events();
  trace::stop();

  std::vector<Event> copies = find(events, Category::Copy, "transport.copy");
  CHECK(copies.size() == 1);
  CHECK(!copies.empty() && copies[0].value >= 8 * 1024 * 1024 && copies[0].count >= 1);

  // A native buffer's snapshot is a counted copy too.
  NativeBuffer buffer = NativeBufferObject::allocate(4096);

  trace::start();
  Bytes snapshot = buffer->toBytes();
  events = trace::events();
  trace::stop();

  std::vector<Event> snapshots = find(events, Category::Copy, "buffer.copy");
  CHECK(snapshots.size() == 1 && snapshots[0].value == 4096);
}

static void threeCausesStayApart() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 4});
  std::atomic<int> settled{0};
  std::atomic<bool> copied{false};

  trace::start();

  // A queued job, a compute stall, and a copy, all on one owner.
  owner->post([] { busy(25); });
  owner->post([&] {
    compute(hold, std::make_tuple(25.0), {.pool = pool}).onSettled([&] { settled++; });
    compute(hold, std::make_tuple(1.0), {.pool = pool}).onSettled([&] { settled++; });

    transportCopy(Bytes(16.0 * 1024 * 1024));
    copied = true;
  });

  CHECK(within(3000, [&] { return settled.load() == 2 && copied.load(); }));
  CHECK(owner->waitIdle(2000));

  std::vector<Event> events = trace::events();
  trace::stop();

  // Each cause has its own category, not one native duration.
  auto longestOf = [&](Category c, const char* name) {
    uint64_t longest = 0;
    for (const Event& e : find(events, c, name)) longest = std::max(longest, e.durationNs);
    return longest;
  };

  CHECK(longestOf(Category::Queue, "wait") >= 15 * kMs);
  CHECK(longestOf(Category::Compute, "compute.wait") >= 15 * kMs);
  CHECK(longestOf(Category::Copy, "transport.copy") > 0);

  std::string json = trace::chromeJson(events);
  CHECK(json.find("\"traceEvents\"") != std::string::npos);
  CHECK(json.find("\"cat\":\"queue\"") != std::string::npos);
  CHECK(json.find("\"cat\":\"compute\"") != std::string::npos);
  CHECK(json.find("\"cat\":\"copy\"") != std::string::npos);
  CHECK(json.find("\"ph\":\"s\"") != std::string::npos && json.find("\"ph\":\"f\"") != std::string::npos);

  if (const char* out = std::getenv("LUCENT_TRACE_OUT")) {
    std::ofstream(out) << json;
    std::printf("trace: wrote %zu events to %s\n", events.size(), out);
  }

  pool->shutdown();
  owner->shutdown();
}

// Native code as the compiler emits it: under a #line naming the source.
#line 7 "demo.lucent.ts"
static void nativeWork() {
  LUCENT_TRACE_SCOPE("demo.work");
  busy(2);
}
#line 315 "trace_test.cpp"

static void nativeWorkKeepsItsSource() {
  trace::start();
  nativeWork();
  std::vector<Event> events = trace::events();
  trace::stop();

  std::vector<Event> work = find(events, Category::Native, "demo.work");
  CHECK(work.size() == 1);
  CHECK(!work.empty() && work[0].site && std::string(work[0].site->file) == "demo.lucent.ts" && work[0].site->line == 8);
  CHECK(!work.empty() && work[0].durationNs >= 1 * kMs);

  std::string json = trace::chromeJson(events);
  CHECK(json.find("demo.lucent.ts:8") != std::string::npos);
}

static void nestedPostsNameTheirParent() {
  auto owner = IsolatedContext::create();
  auto other = IsolatedContext::create();
  std::atomic<bool> done{false};

  trace::start();

  owner->post([&] { other->post([&] { done = true; }); });
  CHECK(within(2000, [&] { return done.load(); }));
  CHECK(owner->waitIdle(2000) && other->waitIdle(2000));

  std::vector<Event> events = trace::events();
  trace::stop();

  std::vector<Event> runs = find(events, Category::Run, "run");
  auto outer = std::find_if(runs.begin(), runs.end(), [&](const Event& e) { return e.context == owner->id(); });
  auto inner = std::find_if(runs.begin(), runs.end(), [&](const Event& e) { return e.context == other->id(); });

  CHECK(outer != runs.end() && inner != runs.end());
  CHECK(outer != runs.end() && inner != runs.end() && inner->parent == outer->id && inner->id != outer->id);

  owner->shutdown();
  other->shutdown();
}

// --- cost ------------------------------------------------------------------------

static void measure() {
  const int n = 2000000;

  auto per = [&](auto f) {
    auto t0 = Clock::now();
    for (int i = 0; i < n; i++) f();
    return std::chrono::duration<double, std::nano>(Clock::now() - t0).count() / n;
  };

  double scopeOff = per([] { LucentScope scope; });
  double siteOff = per([] { LUCENT_TRACE_SCOPE("bench"); });

  trace::start({.capacity = 1 << 12});
  double scopeOn = per([] { LucentScope scope; });
  double siteOn = per([] { LUCENT_TRACE_SCOPE("bench"); });
  trace::stop();

  std::printf("bench: LucentScope off %.2f ns, on %.2f ns; LUCENT_TRACE_SCOPE off %.2f ns, on %.2f ns\n", scopeOff, scopeOn, siteOff,
              siteOn);
}

/// Runs `f` as a turn of the main context, as views' effects run.
template <class F>
static void onMain(F f) {
  std::promise<void> done;
  ExecutionContext::main().post([&] {
    f();
    done.set_value();
  });
  done.get_future().wait();
}

// An effect's runs are spans of their own, at the .lucent.ts line the
// compiler gave it: which bindings run, how often, for how long.
static void effectRunsKeepTheirSite() {
  onMain([] {
    auto g = ui::Graph::create();
    auto title = ui::signal(g, 1.0);

    trace::start();
    auto e = ui::effect(
        g, [title] { (void)title.get(); }, "rows.lucent.tsx:11",
        LUCENT_TRACE_SITE_AT("effect", "rows.lucent.tsx", 11));
    title.set(2.0);
    std::vector<Event> events = trace::events();
    trace::stop();

    std::vector<Event> runs;
    for (auto& ev : events)
      if (ev.category == Category::Effect) runs.push_back(ev);

    CHECK(runs.size() == 2);
    CHECK(!runs.empty() && runs[0].site && runs[0].site->line == 11 &&
          std::string(runs[0].site->file) == "rows.lucent.tsx");
    CHECK(std::string(trace::categoryName(Category::Effect)) == "effect");

    // Off: an effect's run records nothing.
    title.set(3.0);
    CHECK(trace::events().size() == events.size());

    // The effect and the signal it reads hold each other until the graph goes.
    e.dispose();
    g->dispose();
  });
}

int main() {
  offByDefaultAndWhenStopped();
  theBufferIsBounded();
  aQueuedJobWaitsOnItsOwner();
  lockWaitsAreTheirOwnSpans();
  aComputeStallWaitsForAWorker();
  aLargeCopyShowsItsBytes();
  threeCausesStayApart();
  nativeWorkKeepsItsSource();
  nestedPostsNameTheirParent();
  effectRunsKeepTheirSite();

  if (const char* bench = std::getenv("LUCENT_TRACE_BENCH"); bench && std::string(bench) == "1") measure();

  std::printf("trace: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
