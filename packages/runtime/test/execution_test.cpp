// Unit tests for execution contexts (lucent/execution.h): the legacy module
// context, the main context and isolated contexts, their microtasks, and
// what crosses between them. Built and run by `packages/runtime/test/run.sh`,
// also under ASan/UBSan and TSan.
#include <pthread.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "lucent/lucent.h"

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

using Log = std::vector<std::string>;
using Clock = std::chrono::steady_clock;

/// Whether `f` throws std::logic_error: a misuse the runtime refuses.
template <class F>
static bool refused(F f) {
  try {
    f();
  } catch (const std::logic_error&) {
    return true;
  }

  return false;
}

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

/// Captures what reportUncaught writes to stderr while it lives.
class StderrCapture {
 public:
  StderrCapture() {
    std::fflush(stderr);
    file_ = std::tmpfile();
    saved_ = dup(2);
    dup2(fileno(file_), 2);
  }

  std::string finish() {
    std::fflush(stderr);
    dup2(saved_, 2);
    close(saved_);

    std::string text;
    std::rewind(file_);
    for (int c; (c = std::fgetc(file_)) != EOF;) text.push_back(static_cast<char>(c));
    std::fclose(file_);
    return text;
  }

 private:
  FILE* file_;
  int saved_;
};

// --- contexts -------------------------------------------------------------

static void contextsAreDistinct() {
  auto a = IsolatedContext::create();
  auto b = IsolatedContext::create();
  ExecutionContext& legacy = Actor::shared();
  ExecutionContext& main = ExecutionContext::main();

  std::set<ContextId> ids{legacy.id(), main.id(), a->id(), b->id()};
  CHECK(ids.size() == 4 && !ids.count(0));

  std::set<Scope*> roots{legacy.root().get(), main.root().get(), a->root().get(), b->root().get()};
  CHECK(roots.size() == 4 && !roots.count(nullptr));
  CHECK(a->root()->state() == Scope::State::Active);

  CHECK(&legacy == &Actor::shared());
  CHECK(ExecutionContext::current() == nullptr);

  {
    LucentScope scope;

    CHECK(ExecutionContext::current() == &legacy);
    CHECK(legacy.isCurrent() && !main.isCurrent());
    // An actor is named as itself; null names the shared actor too.
    CHECK(ExecutionContext::currentRef().get() == &legacy && &ExecutionContext::of(nullptr) == &legacy);
  }

  CHECK(inside(legacy, [] { return ExecutionContext::current(); }) == &legacy);
  CHECK(inside(main, [] { return ExecutionContext::current(); }) == &main);
  CHECK(inside(*a, [] { return ExecutionContext::current(); }) == a.get());
  CHECK(inside(*b, [] { return ExecutionContext::currentRef(); }) == b);

  a->shutdown();
  b->shutdown();
  CHECK(a->waitStopped(2000) && b->waitStopped(2000));
}

static void microtasksStayInTheirContext() {
  auto a = IsolatedContext::create();
  auto b = IsolatedContext::create();
  Log log;
  bool othersEmpty = false;

  inside(*a, [&] {
    a->enqueueMicrotask([&] { log.push_back(ExecutionContext::current() == a.get() ? "microtask on a" : "elsewhere"); });

    othersEmpty = !b->hasMicrotasks() && !ExecutionContext::main().hasMicrotasks() && !Actor::shared().hasMicrotasks();
    log.push_back("job");
  });

  CHECK(a->waitIdle(2000));
  CHECK(othersEmpty);
  CHECK((log == Log{"job", "microtask on a"}));

  // Queued only on their own context: elsewhere, post.
  CHECK(refused([&] { a->enqueueMicrotask([] {}); }));
  CHECK(refused([] { ExecutionContext::main().enqueueMicrotask([] {}); }));
  CHECK(refused([&] { a->drainMicrotasks(); }));
  CHECK(inside(*b, [&] { return refused([&] { a->enqueueMicrotask([] {}); }); }));

  {
    LucentScope scope;

    CHECK(refused([&] { a->enqueueMicrotask([] {}); }));
  }

  a->shutdown();
  b->shutdown();
}

static void turnsRunTheirMicrotasksFirst() {
  auto a = IsolatedContext::create();
  Log log;

  a->post([&] {
    log.push_back("job");
    a->post([&] { log.push_back("next turn"); });
    a->enqueueMicrotask([&] {
      log.push_back("m1");
      a->enqueueMicrotask([&] { log.push_back("m2"); });
    });

    // A reentrant entry (a platform callback during the job) leaves the
    // microtasks to the turn: they run once the stack is empty.
    {
      ContextEntry nested(*a);
      a->enqueueMicrotask([&] { log.push_back("m3"); });
    }

    log.push_back("job end");
  });

  CHECK(a->waitIdle(2000));
  CHECK((log == Log{"job", "job end", "m1", "m3", "m2", "next turn"}));

  a->shutdown();
}

static void legacyMicrotasksWaitForAnEmptyStack() {
  std::string log;

  Actor::shared().post([&] {
    Actor::shared().enqueueMicrotask([&] { log += "microtask "; });

    // A platform callback into module code during the job (callNow).
    { LucentScope nested; }

    log += "job end ";
  });

  CHECK(Actor::shared().waitIdle(2000));
  CHECK(log == "job end microtask ");
}

static void mainContextNeverTakesTheLucentLock() {
  // A module job holds the Lucent lock until a main-context turn has run.
  // Were the main context to take the lock, that turn would wait for the
  // job, and the job would wait for it.
  std::atomic<bool> mainRan{false};
  std::atomic<bool> lockHeldMeanwhile{false};
  std::atomic<bool> jobSawMain{false};
  ExecutionContext* mainCurrent = nullptr;

  Actor::shared().post([&] {
    ExecutionContext::main().post([&] {
      mainCurrent = ExecutionContext::current();
      lockHeldMeanwhile = !Actor::shared().lock().try_lock();
      if (!lockHeldMeanwhile) Actor::shared().lock().unlock();
      mainRan = true;
    });

    jobSawMain = within(2000, [&] { return mainRan.load(); });
  });

  CHECK(Actor::shared().waitIdle(5000));
  CHECK(jobSawMain && lockHeldMeanwhile);
  CHECK(mainCurrent == &ExecutionContext::main());
}

static void noSynchronousEntryAcrossContexts() {
  auto a = IsolatedContext::create();
  ExecutionContext& main = ExecutionContext::main();

  // Only on the context's own thread, and never the legacy module context
  // (LucentScope enters that one).
  CHECK(refused([&] { ContextEntry entry(main); }));
  CHECK(refused([&] { ContextEntry entry(*a); }));
  CHECK(refused([] { ContextEntry entry(Actor::shared()); }));
  CHECK(inside(*a, [&] { return refused([&] { ContextEntry entry(main); }); }));

  // Module code on the main thread (the legacy main(f)) cannot enter the
  // main context: it would run UI work under the Lucent lock.
  CHECK(inside(main, [&] {
    LucentScope scope;
    return refused([&] { ContextEntry entry(main); });
  }));

  // On its own thread, a context may be entered again.
  CHECK(inside(main, [&] {
    return !refused([&] { ContextEntry entry(main); });
  }));

  a->shutdown();
}

// --- lifetime -------------------------------------------------------------

static void shutdownDisposesOnTheContext() {
  auto a = IsolatedContext::create();
  std::atomic<bool> cleanupOnA{false};
  std::atomic<bool> release{false};
  std::atomic<bool> laterRan{false};

  a->root()->onDispose([&, context = a.get()] { cleanupOnA = ExecutionContext::current() == context; });

  a->post([&] { within(2000, [&] { return release.load(); }); });

  auto queued = std::make_shared<int>(1);
  std::weak_ptr<int> queuedWatch = queued;
  a->post([&, queued] { laterRan = true; });
  queued.reset();

  // Returns while the turn still runs: no wait across threads.
  auto before = Clock::now();
  a->shutdown();
  CHECK(Clock::now() - before < std::chrono::milliseconds(100));

  // Refused afterwards, and released at once.
  auto refusedJob = std::make_shared<int>(1);
  std::weak_ptr<int> refusedWatch = refusedJob;
  CHECK(!a->post([refusedJob] {}));
  refusedJob.reset();
  CHECK(refusedWatch.expired());

  release = true;
  CHECK(a->waitStopped(2000));
  CHECK(cleanupOnA);
  CHECK(!laterRan && queuedWatch.expired());
  CHECK(a->root()->state() == Scope::State::Disposed);
}

static void droppingAContextShutsItDown() {
  std::atomic<bool> cleaned{false};

  {
    auto a = IsolatedContext::create();
    a->root()->onDispose([&] { cleaned = true; });
  }

  CHECK(within(2000, [&] { return cleaned.load(); }));
}

static void ownedPostsDropWithTheirOwner() {
  auto a = IsolatedContext::create();
  auto owner = Scope::create(0, a->root());
  std::atomic<bool> release{false};
  std::atomic<bool> ran{false};

  // The owner is disposed on the context, in the turn before the job's.
  a->post([&] {
    within(2000, [&] { return release.load(); });
    owner->dispose();
  });

  auto payload = std::make_shared<int>(1);
  std::weak_ptr<int> payloadWatch = payload;
  CHECK(a->post([&, payload] { ran = true; }, owner));
  payload.reset();

  release = true;
  CHECK(a->waitIdle(2000));
  CHECK(!ran && payloadWatch.expired());

  CHECK(!a->post([] {}, owner));

  auto live = Scope::create(0, a->root());
  CHECK(a->post([&] { ran = true; }, live));
  CHECK(a->waitIdle(2000));
  CHECK(ran);

  a->shutdown();
}

static void timersRunOnTheirContext() {
  auto a = IsolatedContext::create();
  std::mutex m;
  Log log;

  auto record = [&](ExecutionContext* expected, const char* what) {
    return [&, expected, what] {
      std::lock_guard<std::mutex> g(m);
      log.push_back(ExecutionContext::current() == expected ? what : "elsewhere");
    };
  };

  a->postDelayed(30, record(a.get(), "a late"));
  a->postDelayed(5, record(a.get(), "a early"));
  ExecutionContext::main().postDelayed(5, record(&ExecutionContext::main(), "main"));

  CHECK(within(2000, [&] {
    std::lock_guard<std::mutex> g(m);
    return log.size() == 3;
  }));

  std::lock_guard<std::mutex> g(m);
  auto at = [&](const char* what) { return std::find(log.begin(), log.end(), what) - log.begin(); };
  CHECK(at("a early") < at("a late"));
  CHECK(std::count(log.begin(), log.end(), "a late") == 1 && std::count(log.begin(), log.end(), "main") == 1);

  a->shutdown();
}


// --- promises -------------------------------------------------------------

// Coroutine parameters are by value; the pointers are the test's.
static Promise<void> awaitAndRecord(Promise<double> p, std::vector<ExecutionContext*>* where, double* got,
                                    std::atomic<bool>* done) {
  where->push_back(ExecutionContext::current());
  *got = co_await p;
  where->push_back(ExecutionContext::current());
  *done = true;
}

static void continuationsResumeWhereTheyWereRegistered() {
  auto a = IsolatedContext::create();
  Promise<double> p;
  std::vector<ExecutionContext*> where;
  double got = 0;
  std::atomic<bool> done{false};

  {
    LucentScope scope;
    p = Promise<double>();
  }

  inside(*a, [&] { awaitAndRecord(p, &where, &got, &done); });

  {
    LucentScope scope;
    p.resolve(7);
  }

  CHECK(within(2000, [&] { return done.load(); }));
  CHECK((where == std::vector<ExecutionContext*>{a.get(), a.get()}));
  CHECK(got == 7);

  a->shutdown();
}

static void settlementElsewhereIsPostedToTheOwner() {
  auto a = IsolatedContext::create();
  std::atomic<int> runs{0};
  std::atomic<bool> onOwner{false};
  std::atomic<double> value{-1};

  Promise<double> p = inside(*a, [&] {
    Promise<double> made;
    made.onSettled([&, made] {
      runs++;
      onOwner = a->isCurrent();
      value = made.value();
    });
    return made;
  });

  std::vector<std::thread> threads;
  for (int i = 0; i < 8; i++) threads.emplace_back([p, i] { p.resolve(i); });
  for (auto& t : threads) t.join();

  CHECK(within(2000, [&] { return runs.load() == 1; }));
  CHECK(a->waitIdle(2000));
  CHECK(runs == 1 && onOwner);
  CHECK(value >= 0 && value < 8);
  CHECK(p.settled() && p.value() == value);

  a->shutdown();
}

static void registrationAndSettlementRace() {
  for (int round = 0; round < 50; round++) {
    auto a = IsolatedContext::create();
    Promise<double> p = inside(*a, [] { return Promise<double>(); });
    std::atomic<int> continued{0};
    std::vector<std::thread> threads;

    // Registered from no context: the continuations belong to the legacy
    // module context, and run there.
    for (int i = 0; i < 4; i++) {
      threads.emplace_back([p, &continued] {
        p.onSettled([&continued] {
          if (Actor::shared().lock().heldByCurrentThread()) continued++;
        });
      });
      threads.emplace_back([p, i] { p.resolve(i); });
    }
    for (auto& t : threads) t.join();

    CHECK(within(2000, [&] { return continued.load() == 4; }));

    a->shutdown();
  }
}

static Promise<void> sleepAndRecord(double ms, std::vector<ExecutionContext*>* where, std::atomic<bool>* done) {
  co_await delay(ms);
  where->push_back(ExecutionContext::current());
  *done = true;
}

static void delaysResumeOnTheirContext() {
  auto a = IsolatedContext::create();
  std::vector<ExecutionContext*> onA;
  std::vector<ExecutionContext*> onMain;
  std::atomic<bool> doneA{false};
  std::atomic<bool> doneMain{false};

  inside(*a, [&] { sleepAndRecord(5, &onA, &doneA); });
  inside(ExecutionContext::main(), [&] { sleepAndRecord(5, &onMain, &doneMain); });

  CHECK(within(2000, [&] { return doneA && doneMain; }));
  CHECK((onA == std::vector<ExecutionContext*>{a.get()}));
  CHECK((onMain == std::vector<ExecutionContext*>{&ExecutionContext::main()}));

  a->shutdown();
}

static void promiseAllGathersAcrossContexts() {
  auto a = IsolatedContext::create();
  Promise<double> fromModule;
  std::atomic<bool> done{false};
  std::atomic<bool> onA{false};
  std::string joined;

  {
    LucentScope scope;
    fromModule = Promise<double>();
  }

  Promise<double> fromMain = inside(ExecutionContext::main(), [] { return Promise<double>(); });

  inside(*a, [&] {
    Promise<Array<double>> all = promiseAll(Array<Promise<double>>{fromModule, fromMain});
    all.onSettled([&, all] {
      onA = a->isCurrent();
      joined = all.value().join().toUtf8();
      done = true;
    });
  });

  inside(ExecutionContext::main(), [&] { fromMain.resolve(2); });
  std::thread([fromModule] { fromModule.resolve(1); }).join();

  CHECK(within(2000, [&] { return done.load(); }));
  CHECK(onA && joined == "1,2");

  a->shutdown();
}

static void settlementAfterShutdownIsDropped() {
  auto a = IsolatedContext::create();
  Promise<double> p = inside(*a, [] { return Promise<double>(); });
  std::atomic<bool> continued{false};

  p.onSettled([&] { continued = true; });
  a->shutdown();
  CHECK(a->waitStopped(2000));

  std::thread([p] { p.resolve(1); }).join();
  CHECK(Actor::shared().waitIdle(2000));
  CHECK(!p.settled() && !continued);
}

// --- entry points ---------------------------------------------------------

static void mainCallbacksAvoidTheLucentLock() {
  ExecutionContext& main = ExecutionContext::main();
  std::atomic<bool> ran{false};
  std::atomic<bool> inMain{false};
  std::atomic<bool> locked{true};
  auto captured = std::make_shared<int>(1);
  std::weak_ptr<int> capturedWatch = captured;

  // Queued from a platform thread: a turn of the main context.
  std::thread([&, captured = std::move(captured)]() mutable {
    postTo(main, [&, captured = std::move(captured)] {
      inMain = main.isCurrent() && onMainThread();
      locked = Actor::shared().lock().heldByCurrentThread();
      ran = true;
    });
  }).join();

  CHECK(within(2000, [&] { return ran && capturedWatch.expired(); }));
  CHECK(inMain && !locked);

  // One the platform waits for, on the main thread: runs there, in the
  // main context, and its microtasks run before it returns.
  std::promise<std::string> answered;
  postToMain([&] {
    std::string log;
    double result = callNowIn(main, [&] {
      main.enqueueMicrotask([&] { log += "microtask "; });
      log += Actor::shared().lock().heldByCurrentThread() ? "locked " : "unlocked ";
      return 2.5;
    });
    log += result == 2.5 ? "returned" : "wrong result";
    answered.set_value(log);
  });
  CHECK(answered.get_future().get() == "unlocked microtask returned");

  // Errors do not reach the platform: reported, and a default result. So
  // is a call from a thread the context does not run on.
  std::promise<double> failed;
  postToMain([&] { failed.set_value(callNowIn(main, []() -> double { throwError(String::fromLatin1("RangeError"), String::fromLatin1("in main")); })); });
  CHECK(failed.get_future().get() == 0);
  CHECK(callNowIn(main, [] { return 1.0; }) == 0);
}

static void runInSettlesWithTheCaller() {
  ExecutionContext& main = ExecutionContext::main();
  auto a = IsolatedContext::create();
  Promise<double> fromModule;
  Promise<void> failed;
  std::atomic<bool> ranUnlocked{false};
  std::atomic<bool> continuedLocked{false};

  // From module code: `f` runs on the main thread without the Lucent lock,
  // and the promise, module code's, settles there.
  {
    LucentScope scope;

    fromModule = runIn(main, [&] {
      ranUnlocked = onMainThread() && !Actor::shared().lock().heldByCurrentThread();
      return 42.0;
    });
    fromModule.onSettled([&] { continuedLocked = Actor::shared().lock().heldByCurrentThread(); });

    failed = runIn(*a, [] { throwError(String::fromLatin1("RangeError"), String::fromLatin1("in a")); });
  }

  CHECK(within(2000, [&] { return fromModule.settled() && failed.settled() && continuedLocked; }));
  CHECK(ranUnlocked && fromModule.value() == 42);
  CHECK(!failed.fulfilled() && failed.error()->message.toUtf8() == "in a");

  // From the main context to an isolated one, and back.
  std::atomic<bool> backOnMain{false};
  inside(main, [&] {
    Promise<double> p = runIn(*a, [&] { return a->isCurrent() ? 1.0 : 0.0; });
    p.onSettled([&, p] { backOnMain = main.isCurrent() && p.value() == 1; });
  });
  CHECK(within(2000, [&] { return backOnMain.load(); }));

  // A context that has shut down rejects.
  a->shutdown();
  Promise<double> refusedRun;
  {
    LucentScope scope;
    refusedRun = runIn(*a, [] { return 1.0; });
  }
  CHECK(refusedRun.settled() && !refusedRun.fulfilled());
}

static void legacyMainStillHoldsTheLock() {
  Promise<bool> p;

  {
    LucentScope scope;
    p = runOnMain([] { return onMainThread() && Actor::shared().lock().heldByCurrentThread(); });
  }

  CHECK(within(2000, [&] { return p.settled(); }));
  CHECK(p.fulfilled() && p.value());
}

static void aReleasedLockGoesToItsWaiter() {
  LucentLock& lock = Actor::shared().lock();
  std::atomic<bool> trying{false};
  std::atomic<int> turns{0};
  int waiterGotInAt = -1;

  lock.lock();

  std::thread waiter([&] {
    trying = true;
    lock.lock();
    waiterGotInAt = turns.load();
    lock.unlock();
  });

  CHECK(within(2000, [&] { return trying.load(); }));

  // Long enough for the waiter to block on the lock.
  std::this_thread::sleep_for(std::chrono::milliseconds(20));

  // An owner that releases and takes the lock straight back, as a Lucent
  // loop yielding between turns does, lets the waiter in first.
  for (int i = 0; i < 100000 && waiterGotInAt < 0; i++) {
    lock.unlock();
    lock.lock();
    turns++;
  }

  lock.unlock();
  waiter.join();

  CHECK(waiterGotInAt >= 0 && waiterGotInAt <= 1);
}

static Promise<void> yieldUntil(std::atomic<bool>* stop, std::atomic<int>* turns) {
  while (!*stop) {
    // A slice of work, then a yield: `await delay(0)`.
    auto until = Clock::now() + std::chrono::microseconds(200);
    while (Clock::now() < until) {
    }

    (*turns)++;
    co_await delay(0);
  }
}

/// Calls from the JS thread into `actor` while its thread runs a loop that
/// yields: each waits for about one turn, on any actor.
static void callsEnterBetweenYieldingTurns(Actor& actor) {
  std::atomic<bool> stop{false};
  std::atomic<int> turns{0};

  { LucentScope scope(actor); }
  actor.post([&] { yieldUntil(&stop, &turns); });
  CHECK(within(2000, [&] { return turns.load() > 10; }));

  // The JS thread's calls into module code, each waiting for the lock.
  auto start = Clock::now();
  double longest = 0;

  for (int i = 0; i < 50; i++) {
    // JavaScript runs its own code between calls (timers, rendering).
    std::this_thread::sleep_for(std::chrono::milliseconds(1));

    auto asked = Clock::now();

    { LucentScope scope(actor); }

    longest = std::max(longest, std::chrono::duration<double, std::milli>(Clock::now() - asked).count());
  }

  double total = std::chrono::duration<double, std::milli>(Clock::now() - start).count();

  stop = true;
  CHECK(actor.waitIdle(2000));

  // Each call waits for about the turn running when it asked.
  std::printf("execution: 50 calls into %s against a yielding loop took %.1f ms, the longest %.2f ms\n", actor.name(), total, longest);
  CHECK(longest < 50);
  CHECK(total < 1000);
}

// --- abort ----------------------------------------------------------------

static void abortRunsListenersOnTheOwner() {
  auto a = IsolatedContext::create();
  AbortController controller = inside(*a, [] { return std::make_shared<AbortControllerObject>(); });
  std::atomic<int> runs{0};
  std::atomic<bool> onA{false};

  inside(*a, [&] {
    controller->signal->addEventListener([&] {
      onA = a->isCurrent();
      runs++;
    });
  });

  // Requested from another thread: the listeners run on the owner.
  std::thread([controller] { controller->abort(undefined); }).join();

  CHECK(within(2000, [&] { return runs.load() == 1; }));
  CHECK(onA && controller->signal->aborted);
  CHECK(controller->signal->reason->name.toUtf8() == "AbortError");

  // A listener added from elsewhere joins on the owner; if the signal
  // aborted meanwhile, it runs there at once.
  std::atomic<bool> late{false};
  controller->signal->add([&] { late = a->isCurrent(); });
  CHECK(within(2000, [&] { return late.load(); }));

  a->shutdown();
}

static void listenerErrorsAreReported() {
  std::string log;
  std::string reported;

  {
    LucentScope scope;
    AbortController controller = std::make_shared<AbortControllerObject>();

    controller->signal->addEventListener([] { throw 42; });
    controller->signal->addEventListener([&] { log += "second "; });

    StderrCapture capture;
    try {
      controller->abort(undefined);
    } catch (...) {
      log += "escaped ";
    }
    reported = capture.finish();

    // After abort, a listener would never run: refused with id 0.
    bool ran = false;
    CHECK(controller->signal->add([&] { ran = true; }) == 0);
    CHECK(!ran);
  }

  CHECK(log == "second ");
  CHECK(reported.find("uncaught exception in abort listener") != std::string::npos);
}

static Promise<void> waitOrAbort(AbortSignal signal, std::string* outcome, std::atomic<bool>* done) {
  try {
    co_await delay(2000, signal);
    *outcome = "finished";
  } catch (const Exception& e) {
    *outcome = e.error()->name.toUtf8();
  }

  *outcome += ExecutionContext::current() == nullptr ? " nowhere" : " on " + std::to_string(ExecutionContext::current()->id());
  *done = true;
}

static void delayAbortedFromAnotherContext() {
  auto a = IsolatedContext::create();
  AbortController controller;
  std::string outcome;
  std::atomic<bool> done{false};

  {
    LucentScope scope;
    controller = std::make_shared<AbortControllerObject>();
  }

  inside(*a, [&] { waitOrAbort(controller->signal, &outcome, &done); });
  std::this_thread::sleep_for(std::chrono::milliseconds(10));
  std::thread([controller] { controller->abort(undefined); }).join();

  CHECK(within(1000, [&] { return done.load(); }));
  CHECK(outcome == "AbortError on " + std::to_string(a->id()));

  a->shutdown();
}

// --- scopes ---------------------------------------------------------------

static void disposalRunsOnTheOwner() {
  auto a = IsolatedContext::create();
  auto scope = Scope::create(0, a->root());
  std::atomic<bool> cleaned{false};
  std::atomic<bool> cleanedOnA{false};

  scope->onDispose([&] {
    cleanedOnA = a->isCurrent();
    cleaned = true;
  });

  // From another thread: posted to the owner, returning without waiting.
  CHECK(scope->dispose() == nullptr);
  CHECK(within(2000, [&] { return cleaned.load(); }));
  CHECK(cleanedOnA && scope->state() == Scope::State::Disposed);

  // On the owner: at once, errors returned to the caller.
  auto here = Scope::create(0, a->root());
  here->onDispose([] { throwError(String::fromLatin1("Error"), String::fromLatin1("cleanup")); });
  CHECK(inside(*a, [&] { return here->dispose() != nullptr && here->state() == Scope::State::Disposed; }));

  // Module scopes: on the Lucent thread, holding the lock.
  auto module = Scope::create(0, Actor::shared().root());
  std::atomic<bool> locked{false};
  module->onDispose([&] { locked = Actor::shared().lock().heldByCurrentThread() && Actor::shared().onActorThread(); });
  module->dispose();
  CHECK(within(2000, [&] { return locked.load(); }));

  a->shutdown();
}

static void lastReferenceDisposesOnTheOwner() {
  auto a = IsolatedContext::create();
  std::atomic<bool> cleaned{false};
  std::atomic<bool> cleanedOnA{false};
  std::atomic<bool> childOnA{false};

  {
    auto root = Scope::createRoot(0, a);
    auto child = Scope::create(0, root);
    root->onDispose([&] {
      cleanedOnA = a->isCurrent();
      cleaned = true;
    });
    child->onDispose([&] { childOnA = a->isCurrent(); });
  }

  CHECK(within(2000, [&] { return cleaned.load(); }));
  CHECK(cleanedOnA && childOnA);

  // Once the owner has shut down, disposal runs where it is asked for.
  auto orphan = Scope::createRoot(0, a);
  bool orphanCleaned = false;
  orphan->onDispose([&] { orphanCleaned = true; });

  a->shutdown();
  CHECK(a->waitStopped(2000));
  CHECK(orphan->dispose() == nullptr && orphanCleaned);
}

static void childOfDisposedParentIsDisposedAtOnce() {
  auto a = IsolatedContext::create();
  auto parent = Scope::create(0, a->root());

  inside(*a, [&] { parent->dispose(); });

  auto child = Scope::create(0, parent);
  CHECK(child->state() == Scope::State::Disposed);

  a->shutdown();
}

/// The calling thread's stack size, as its pthread attributes say (0 where
/// the platform does not).
static size_t stackSize() {
#if defined(__APPLE__)
  return pthread_get_stacksize_np(pthread_self());
#elif defined(__linux__)
  pthread_attr_t attr;
  if (pthread_getattr_np(pthread_self(), &attr) != 0) return 0;
  void* low = nullptr;
  size_t size = 0;
  pthread_attr_getstack(&attr, &low, &size);
  pthread_attr_destroy(&attr);
  return size;
#else
  return 0;
#endif
}

/// Lucent's own threads (the Lucent thread, isolated contexts, which
/// compute workers are, and the main context's clock) get
/// kThreadStackSize, not the platform's small default for a secondary
/// thread (512 KB on iOS).
static void threadsHaveTheirStack() {
  std::atomic<size_t> lucent{0}, isolated{0}, clock{0};

  Actor::shared().post([&] { lucent = stackSize(); });

  auto context = IsolatedContext::create();
  context->post([&] { isolated = stackSize(); });

  // A timer of the main context fires on its clock thread, which posts it on.
  WorkerThread::start([&](Job& job) {
    clock = stackSize();
    job();
  })->post([] {});

  CHECK(within(2000, [&] { return lucent && isolated && clock; }));
  CHECK(lucent >= size_t{8} * 1024 * 1024);
  CHECK(isolated >= size_t{8} * 1024 * 1024);
  CHECK(clock >= size_t{8} * 1024 * 1024);

  context->shutdown();
}

int main() {
#if defined(__linux__)
  // glibc gives a thread that sets no stack size the stack rlimit, 8 MB on
  // most Linux machines, which would hide one Lucent forgot to set: a
  // phone's default for secondary threads instead, before any starts.
  pthread_attr_t phone;
  pthread_attr_init(&phone);
  pthread_attr_setstacksize(&phone, 1024 * 1024);
  pthread_setattr_default_np(&phone);
  pthread_attr_destroy(&phone);
#endif

  contextsAreDistinct();
  microtasksStayInTheirContext();
  turnsRunTheirMicrotasksFirst();
  legacyMicrotasksWaitForAnEmptyStack();
  mainContextNeverTakesTheLucentLock();
  noSynchronousEntryAcrossContexts();
  shutdownDisposesOnTheContext();
  droppingAContextShutsItDown();
  ownedPostsDropWithTheirOwner();
  timersRunOnTheirContext();
  continuationsResumeWhereTheyWereRegistered();
  settlementElsewhereIsPostedToTheOwner();
  registrationAndSettlementRace();
  delaysResumeOnTheirContext();
  promiseAllGathersAcrossContexts();
  settlementAfterShutdownIsDropped();
  mainCallbacksAvoidTheLucentLock();
  runInSettlesWithTheCaller();
  legacyMainStillHoldsTheLock();
  aReleasedLockGoesToItsWaiter();
  callsEnterBetweenYieldingTurns(Actor::shared());
  callsEnterBetweenYieldingTurns(Actor::create("yielding"));
  abortRunsListenersOnTheOwner();
  listenerErrorsAreReported();
  delayAbortedFromAnotherContext();
  disposalRunsOnTheOwner();
  lastReferenceDisposesOnTheOwner();
  childOfDisposedParentIsDisposedAtOnce();
  threadsHaveTheirStack();

  std::printf("execution: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
