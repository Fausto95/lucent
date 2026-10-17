// Stress runs of the runtime (T151), built and run by `packages/runtime/test/run.sh`, also
// under ASan/UBSan and TSan: native operations whose registration, completion and
// cancellation race from several threads; settlements that re-enter their context
// synchronously; late outcomes racing a context's shutdown; and 1,000 subscribe and
// cancel cycles, and mount and dispose cycles, after warmup, whose owned counts return
// to their baseline (P7). LUCENT_STRESS_ITERATIONS sets the races' rounds.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "lucent/callback.h"
#include "lucent/channel.h"
#include "lucent/debug.h"
#include "lucent/lucent.h"
#include "lucent/operation.h"
#include "lucent/reactive.h"

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

using Clock = std::chrono::steady_clock;

/// The races' rounds: LUCENT_STRESS_ITERATIONS, else `fallback`.
static int rounds(int fallback) {
  const char* n = std::getenv("LUCENT_STRESS_ITERATIONS");
  return n ? std::atoi(n) : fallback;
}

/// What P7 runs: cycles after warmup.
constexpr int CYCLES = 1000;
constexpr int WARMUP = 50;

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

/// Runs `f` as a turn of `context` and waits for it.
template <class F>
static void inside(ExecutionContext& context, F f) {
  std::promise<void> ran;
  auto future = ran.get_future();

  context.post([&] {
    f();
    ran.set_value();
  });

  if (future.wait_for(std::chrono::seconds(10)) != std::future_status::ready) {
    std::fprintf(stderr, "a turn did not run within 10 s\n");
    std::abort();
  }
}

/// Runs each of `fs` on a thread of its own, all let go at once.
template <class... F>
static void race(F... fs) {
  std::atomic<int> ready{0};
  std::atomic<bool> go{false};
  std::vector<std::thread> threads;

  auto launch = [&](auto f) {
    threads.emplace_back([&ready, &go, f]() mutable {
      ready.fetch_add(1);
      while (!go.load()) std::this_thread::yield();
      f();
    });
  };
  (launch(fs), ...);

  while (ready.load() != static_cast<int>(sizeof...(F))) std::this_thread::yield();
  go.store(true);

  for (auto& t : threads) t.join();
}

/// A result that counts what is made of it and what is released.
struct Probe : Object {
  static inline std::atomic<int> made{0};
  static inline std::atomic<int> released{0};

  Probe() { made++; }
  ~Probe() override { released++; }
};

/// Native work a test completes by hand, from its own threads.
template <class T>
struct Pending {
  std::mutex m;
  std::shared_ptr<Operation<T>> operation;
  std::atomic<int> started{0};
  /// How many times the native work was told to stop.
  std::atomic<int> stopped{0};

  typename Operation<T>::Registration registration() {
    return [this](const std::shared_ptr<Operation<T>>& op) -> std::function<void()> {
      std::lock_guard<std::mutex> g(m);
      operation = op;
      started++;
      return [this] { stopped++; };
    };
  }

  std::shared_ptr<Operation<T>> op() {
    std::lock_guard<std::mutex> g(m);
    return operation;
  }
};

/// How a promise settled, seen from the test thread.
struct Settled {
  std::atomic<int> times{0};
  std::atomic<bool> fulfilled{false};
  std::atomic<bool> onOwner{false};
  /// Written before `times`.
  std::string error;
};

/// Watches `promise` without holding it: one its owner's shutdown keeps from settling
/// goes, with what waits on it.
template <class T>
static std::shared_ptr<Settled> watch(ExecutionContext& owner, Promise<T> promise) {
  auto settled = std::make_shared<Settled>();

  promise.whenSettled([settled, &owner](Promise<T> p) {
    settled->onOwner = owner.isCurrent();
    if (p.fulfilled())
      settled->fulfilled = true;
    else
      settled->error = p.error()->message.toUtf8();
    settled->times++;
  });

  return settled;
}

/// Whether the owned counts are where they were: each kind P7 counts.
static bool atBaseline(const debug::Resources& before) {
  const debug::Resources now = debug::resources();
  return now.nativeRefs == before.nativeRefs && now.scopes == before.scopes && now.operations == before.operations &&
         now.resources == before.resources && now.effects == before.effects && now.signals == before.signals &&
         now.computeds == before.computeds;
}

static void report(const char* what, const debug::Resources& before) {
  const debug::Resources now = debug::resources();
  std::fprintf(stderr,
               "%s: nativeRefs %ld -> %ld, scopes %ld -> %ld, operations %ld -> %ld, resources %ld -> %ld, "
               "effects %ld -> %ld, signals %ld -> %ld, computeds %ld -> %ld\n",
               what, before.nativeRefs, now.nativeRefs, before.scopes, now.scopes, before.operations, now.operations,
               before.resources, now.resources, before.effects, now.effects, before.signals, now.signals,
               before.computeds, now.computeds);
}

// --- races ------------------------------------------------------------------------

/// An operation's registration on its owner races an abort, a success and a failure
/// from three other threads. Whatever wins settles the promise once, on the owner;
/// started work is told to stop once; a value that loses is released.
static void registrationCompletionAndCancellationRace() {
  const int n = rounds(300);
  const int madeBefore = Probe::made;
  const int releasedBefore = Probe::released;
  int wins[3] = {0, 0, 0};
  int neverStarted = 0;
  bool ok = true;

  for (int i = 0; i < n; i++) {
    auto owner = IsolatedContext::create();
    AbortController controller;
    inside(*owner, [&] { controller = std::make_shared<AbortControllerObject>(); });
    Pending<Ref<Probe>> native;
    std::shared_ptr<Settled> settled;
    std::atomic<bool> issued{false};

    // The operation, once its registration has run or the abort kept it from starting.
    auto started = [&]() -> std::shared_ptr<Operation<Ref<Probe>>> {
      while (!native.started.load() && !issued.load()) std::this_thread::yield();
      return native.op();
    };

    race(
        [&] {
          inside(*owner, [&] {
            settled = watch(*owner, nativeOperation<Ref<Probe>>(native.registration(), controller->signal));
            issued = true;
          });
        },
        [&] { controller->abort(makeError(str("AbortError"), str("stop"))); },
        [&] {
          if (auto op = started()) op->succeed(Ref<Probe>(new Probe()));
        },
        [&] {
          if (auto op = started()) op->fail(makeError(str("failed")));
        });

    ok = ok && within(5000, [&] { return settled && settled->times.load() > 0; });
    CHECK(owner->waitIdle(5000));
    ok = ok && settled->times == 1 && settled->onOwner;

    if (auto op = native.op()) {
      const auto state = op->state();
      ok = ok && within(2000, [&] { return native.stopped.load() == 1; });
      if (settled->fulfilled) {
        ok = ok && state == OperationState::Succeeded;
        wins[0]++;
      } else if (settled->error == "failed") {
        ok = ok && state == OperationState::Failed;
        wins[1]++;
      } else {
        ok = ok && state == OperationState::Cancelled && settled->error == "stop";
        wins[2]++;
      }
    } else {
      // The abort came first: the registration never ran.
      ok = ok && !settled->fulfilled && settled->error == "stop" && native.started == 0;
      neverStarted++;
    }

    owner->shutdown();
    ok = ok && owner->waitStopped(5000);
  }

  CHECK(ok);
  // Every value made was released: delivered and dropped, or lost and released.
  CHECK(within(5000, [&] { return Probe::released.load() - releasedBefore == Probe::made.load() - madeBefore; }));
  std::printf("  %d rounds: success %d, failure %d, cancelled %d, never started %d\n", n, wins[0], wins[1], wins[2],
              neverStarted);
}

/// A settlement's continuation re-enters its context synchronously: it completes the
/// operation again (a late outcome), starts one its registration settles, and starts
/// and aborts another, all in the same turn. Each settles once, in order.
static void settlementsReenterSynchronously() {
  const int n = rounds(300);
  auto owner = IsolatedContext::create();
  bool ok = true;

  for (int i = 0; i < n; i++) {
    auto log = std::make_shared<std::vector<std::string>>();
    auto a = std::make_shared<Pending<double>>();
    auto c = std::make_shared<Pending<double>>();

    inside(*owner, [&] {
      Promise<double> first = nativeOperation<double>(a->registration());
      first.onSettled([log, first, a, c] {
        log->push_back("a " + std::to_string(static_cast<int>(first.value())));
        // Completing it again loses: a late outcome.
        if (a->op()->succeed(2)) log->push_back("a again");

        Promise<double> b =
            nativeOperation<double>([](const std::shared_ptr<Operation<double>>& op) -> std::function<void()> {
              op->succeed(3);
              return [] {};
            });
        b.onSettled([log, b] { log->push_back("b " + std::to_string(static_cast<int>(b.value()))); });

        auto controller = std::make_shared<AbortControllerObject>();
        Promise<double> third = nativeOperation<double>(c->registration(), controller->signal);
        third.onSettled([log, third] { log->push_back("c " + third.error()->message.toUtf8()); });
        controller->abort(makeError(str("AbortError"), str("stop")));
      });

      // Settled in the owner's turn, by its own thread.
      a->op()->succeed(1);
    });

    ok = ok && owner->waitIdle(5000);
    ok = ok && (*log == std::vector<std::string>{"a 1", "b 3", "c stop"});
    ok = ok && a->op()->lateOutcomes() == 1 && a->stopped == 1 && c->stopped == 1;
  }

  CHECK(ok);
  owner->shutdown();
  CHECK(owner->waitStopped(5000));
}

/// A success from native code races its owner's shutdown: delivered if it came first,
/// else dropped and released. The work is told to stop once either way.
static void lateOutcomesRaceShutdown() {
  const int n = rounds(300);
  const int madeBefore = Probe::made;
  const int releasedBefore = Probe::released;
  bool ok = true;
  int delivered = 0;

  for (int i = 0; i < n; i++) {
    auto owner = IsolatedContext::create();
    Pending<Ref<Probe>> native;
    std::shared_ptr<Settled> settled;
    inside(*owner, [&] { settled = watch(*owner, nativeOperation<Ref<Probe>>(native.registration())); });

    race([&] { native.op()->succeed(Ref<Probe>(new Probe())); }, [&] { owner->shutdown(); });

    ok = ok && owner->waitStopped(5000);
    ok = ok && within(2000, [&] { return native.stopped.load() == 1; });
    ok = ok && settled->times <= 1;
    if (settled->times == 1) delivered++;
  }

  CHECK(ok);
  CHECK(within(5000, [&] { return Probe::released.load() - releasedBefore == Probe::made.load() - madeBefore; }));
  std::printf("  %d rounds: delivered %d, dropped %d\n", n, delivered, n - delivered);
}

// --- cycles -----------------------------------------------------------------------

using Cleanup = Opt<Fn<void()>>;
using Next = Fn<void(double)>;
using End = Fn<void()>;
using Reject = Fn<void(Error)>;
using Subscription = Fn<Cleanup(Next, End, Reject)>;

/// 1,000 subscribe and cancel cycles after warmup: a subscription its signal ends, a
/// channel's subscriber removed, an operation cancelled under a scope disposed. The
/// owned counts return to where they were after warmup, and every cleanup ran.
static void subscribeAndCancelCycles() {
  auto owner = IsolatedContext::create();
  auto cleanups = std::make_shared<std::atomic<int>>(0);
  auto values = std::make_shared<std::atomic<int>>(0);

  auto cycle = [&] {
    inside(*owner, [&] {
      auto controller = std::make_shared<AbortControllerObject>();
      subscribe(Subscription([cleanups](Next next, End, Reject) {
                  next(1);
                  return Cleanup(Fn<void()>([cleanups] { (*cleanups)++; }));
                }),
                Next([values](double) { (*values)++; }), controller->signal);
      controller->abort(makeError(str("AbortError")));

      auto channel = ChannelObject<double>::create(ChannelPolicy::Lossless, 4);
      EventSubscription subscription = channel->subscribe(Fn<void(double)>([values](double) { (*values)++; }));
      channel->send(1);
      subscription->remove();

      auto scope = Scope::create(0, owner->root());
      Pending<double> native;
      auto op = Operation<double>::start(scope, native.registration());
      scope->dispose();
    });
  };

  for (int i = 0; i < WARMUP; i++) cycle();
  CHECK(owner->waitIdle(5000));
  const debug::Resources before = debug::resources();
  const int cleanupsBefore = *cleanups;

  for (int i = 0; i < CYCLES; i++) cycle();
  CHECK(owner->waitIdle(5000));

  const bool back = within(5000, [&] { return atBaseline(before); });
  if (!back) report("subscribe and cancel", before);
  CHECK(back);
  CHECK(*cleanups - cleanupsBefore == CYCLES);

  owner->shutdown();
  CHECK(owner->waitStopped(5000));
}

/// 1,000 mount and dispose cycles after warmup, on the main context, as a view's mount
/// lives: its scope under the context's root, with an operation and a resource, and its
/// reactive graph of signals, computed values and effects. The owned counts return to
/// where they were after warmup.
static void mountAndDisposeCycles() {
  auto effects = std::make_shared<std::atomic<int>>(0);
  auto cycle = [effects] {
    auto mount = Scope::create(0, ExecutionContext::main().root());
    auto pending = Operation<void>::start(mount);
    auto file = Resource::open(str("mounted"), [] {});

    auto g = ui::Graph::create();
    auto label = ui::signal(g, 1.0);
    auto doubled = ui::computed(g, [label] { return label.get() * 2; });
    auto e = ui::effect(g, [doubled, effects] {
      (void)doubled.get();
      (*effects)++;
    });
    label.set(2.0);

    e.dispose();
    g->dispose();
    file->close();
    mount->dispose();
  };

  std::promise<bool> done;
  ExecutionContext::main().post([&] {
    for (int i = 0; i < WARMUP; i++) cycle();
    const debug::Resources before = debug::resources();
    const int effectsBefore = *effects;

    for (int i = 0; i < CYCLES; i++) cycle();

    const bool back = atBaseline(before);
    if (!back) report("mount and dispose", before);
    // Each mount's effect ran when it was made, and again when its signal changed.
    done.set_value(back && *effects - effectsBefore >= CYCLES);
  });

  auto future = done.get_future();
  CHECK(future.wait_for(std::chrono::seconds(60)) == std::future_status::ready && future.get());
}

int main() {
  std::printf("registration, completion and cancellation race\n");
  registrationCompletionAndCancellationRace();
  std::printf("settlements re-enter synchronously\n");
  settlementsReenterSynchronously();
  std::printf("late outcomes race shutdown\n");
  lateOutcomesRaceShutdown();
  std::printf("subscribe and cancel cycles\n");
  subscribeAndCancelCycles();
  std::printf("mount and dispose cycles\n");
  mountAndDisposeCycles();

  std::printf("stress: %d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
