// Unit tests for module actors (lucent/scheduler.h): a lock and a thread per
// actor, so one actor's long job delays neither another actor nor the main
// thread; the main thread's entries, which never queue behind module jobs;
// JavaScript callbacks that lend their actors to the main thread; and nested
// waits across actors that cannot close a cycle. Fake threads stand in for
// React Native's JS thread. Built and run by `packages/runtime/test/run.sh`,
// also under ASan/UBSan and TSan.
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <string>
#include <thread>

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

using Clock = std::chrono::steady_clock;

static double msSince(Clock::time_point t) { return std::chrono::duration<double, std::milli>(Clock::now() - t).count(); }

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

/// Waits for `f`, failing the run (not hanging it) after 5 s: a deadlock.
template <class T>
static T settled(std::future<T>& f, const char* what) {
  if (f.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    std::fprintf(stderr, "deadlock: %s did not finish within 5 s\n", what);
    std::fflush(stderr);
    std::_Exit(2);
  }

  return f.get();
}

/// Runs `f` on the main thread (the host's stand-in) and gives its result.
template <class F>
static auto onMain(F f) -> std::future<decltype(f())> {
  auto task = std::make_shared<std::packaged_task<decltype(f())()>>(std::move(f));
  auto future = task->get_future();
  postToMain([task] { (*task)(); });
  return future;
}

/// Holds `actor` on its own thread for `ms`: a long module job.
static void busy(Actor& actor, double ms, std::atomic<bool>* started = nullptr) {
  actor.post([ms, started] {
    if (started) *started = true;
    auto until = Clock::now() + std::chrono::microseconds(static_cast<int64_t>(ms * 1000));
    while (Clock::now() < until) {
    }
  });
}

/// Captures what logError writes to stderr while it lives.
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

// --- one actor per package -------------------------------------------------------

static Promise<double> whereAfterDelay(Actor* expected) {
  co_await delay(0);
  co_return Actor::current() == expected ? 1.0 : 0.0;
}

static void actorsAreDistinct() {
  Actor& a = Actor::create("a");
  Actor& b = Actor::create("b");

  CHECK(&a != &b && &a != &Actor::shared() && &a.lock() != &b.lock());
  CHECK(std::string(a.name()) == "a" && a.isActor() && !ExecutionContext::main().isActor());

  // Entered, an actor is current, and nested entries stack.
  CHECK(Actor::current() == nullptr);
  {
    LucentScope inA(a);
    CHECK(Actor::current() == &a && ExecutionContext::current() == &a && a.lock().heldByCurrentThread());
    {
      LucentScope inB(b);
      CHECK(Actor::current() == &b && a.lock().heldByCurrentThread() && b.lock().heldByCurrentThread());
    }
    CHECK(Actor::current() == &a && !b.lock().heldByCurrentThread());
  }
  CHECK(Actor::current() == nullptr && !a.lock().heldByCurrentThread());

  // Each actor's turns run on its own thread, holding its own lock.
  std::promise<bool> ran;
  auto result = ran.get_future();
  b.post([&] { ran.set_value(b.onActorThread() && !a.onActorThread() && b.lock().heldByCurrentThread() && !a.lock().heldByCurrentThread() && Actor::current() == &b); });
  CHECK(settled(result, "a turn of b"));

  // Called only synchronously, an actor has no thread: it starts with its
  // first job.
  Actor& idle = Actor::create("idle");
  { LucentScope call(idle); }
  CHECK(!idle.hasThread() && idle.pendingWork() == 0 && idle.waitIdle(0));
  idle.post([] {});
  CHECK(idle.hasThread() && idle.waitIdle(2000));

  // Work started in an actor belongs to it: posted back, continued there.
  Promise<double> p;
  {
    LucentScope inA(a);
    p = whereAfterDelay(&a);
  }
  CHECK(within(2000, [&] { return p.settled(); }) && p.fulfilled() && p.value() == 1);
}

static void aLongJobDelaysNeitherAnotherActorNorMain() {
  Actor& slow = Actor::create("slow");
  Actor& quick = Actor::create("quick");
  std::atomic<bool> started{false};

  busy(slow, 400, &started);
  CHECK(within(2000, [&] { return started.load(); }));
  auto start = Clock::now();

  // Another actor's turn, and a call into it from the JS thread.
  std::promise<double> turn;
  auto turned = turn.get_future();
  quick.post([&] { turn.set_value(msSince(start)); });
  double quickTurn = settled(turned, "a turn of another actor");

  auto asked = Clock::now();
  { LucentScope call(quick); }
  double quickCall = msSince(asked);

  // The main thread, which runs its own work at once.
  auto mainTurn = onMain([&] { return msSince(start); });
  double mainRan = settled(mainTurn, "a main-thread job");

  // A main-thread entry into the busy actor waits for it without blocking
  // the main thread: the job after it runs first.
  std::atomic<double> entered{-1};
  std::atomic<bool> wasBusy{false};
  postToMain([&] {
    enterFromMain(slow, [&] { entered = msSince(start); });
    wasBusy = entered.load() < 0;
  });
  auto after = onMain([&] { return entered.load() < 0; });
  CHECK(settled(after, "the main thread's next job") && wasBusy.load());
  CHECK(within(3000, [&] { return entered.load() >= 0; }));

  std::printf("actor: while another actor ran 400 ms, a turn ran after %.2f ms, a call after %.2f ms, main after %.2f ms; main entered it after %.0f ms\n",
              quickTurn, quickCall, mainRan, entered.load());
  CHECK(quickTurn < 100 && quickCall < 100 && mainRan < 100);
  CHECK(entered.load() >= 300);
  CHECK(slow.waitIdle(2000) && quick.waitIdle(2000));
}

static void mainFromModuleCodeRunsOnceTheActorIsFree() {
  Actor& a = Actor::create("main-from-module");
  Promise<bool> p;

  // main(f) from module code: f runs on the main thread holding the
  // caller's actor, after the job that called it ends.
  std::promise<void> called;
  auto done = called.get_future();
  a.post([&] {
    p = runOnMain([&a] { return onMainThread() && a.lock().heldByCurrentThread() && Actor::current() == &a; });
    auto until = Clock::now() + std::chrono::milliseconds(100);
    while (Clock::now() < until) {
    }
    called.set_value();
  });
  settled(done, "the job calling main()");

  CHECK(within(2000, [&] { return p.settled(); }));
  CHECK(p.fulfilled() && p.value());
}

// --- the main thread must answer: never behind the queue --------------------------

static void mainWaitsOnlyForTheHolder() {
  Actor& a = Actor::create("holder");
  std::atomic<bool> holding{false}, release{false}, queuedIn{false};
  std::atomic<double> mainIn{-1}, queuedAt{-1};
  auto start = Clock::now();

  std::thread holder([&] {
    LucentScope scope(a);
    holding = true;
    within(5000, [&] { return release.load(); });
  });
  CHECK(within(2000, [&] { return holding.load(); }));

  // Another thread queues for the actor (a JS call, a turn).
  std::thread queued([&] {
    LucentScope scope(a);
    queuedIn = true;
    queuedAt = msSince(start);
  });
  std::this_thread::sleep_for(std::chrono::milliseconds(20));

  setMainWaitWarningMs(30);
  StderrCapture capture;

  // A delegate the platform calls on the main thread, which must answer.
  auto answer = onMain([&] {
    return callNow(a, [&] {
      mainIn = msSince(start);
      return a.lock().heldByCurrentThread() && !queuedIn.load();
    });
  });

  std::this_thread::sleep_for(std::chrono::milliseconds(80));
  release = true;

  bool aheadOfTheQueue = settled(answer, "the main thread's entry");
  holder.join();
  queued.join();
  std::string err = capture.finish();
  setMainWaitWarningMs(50);

  // It went in when the holder left, before the thread queued ahead of it.
  CHECK(aheadOfTheQueue);
  CHECK(mainIn.load() >= 0 && queuedAt.load() >= mainIn.load());

#ifndef NDEBUG
  // A debug build says the main thread waited.
  CHECK(err.find("the main thread has waited") != std::string::npos && err.find("holder") != std::string::npos);
#endif
}

/// The suspected deadlock: the JS thread, in a synchronous call into an
/// actor, calls a JavaScript callback that waits for the main thread
/// (RCTUnsafeExecuteOnMainQueueSync), while the main thread enters the same
/// actor for a delegate. The callback lends the actor to the main thread.
static void aJavaScriptCallbackLendsItsActorToMain() {
  Actor& a = Actor::create("lent");
  std::atomic<bool> mainHadIt{false}, jsHadItBack{false};

  std::thread js([&] {
    LucentScope call(a);
    int moduleState = 1;

    {
      // The callback's JavaScript, which waits for the main thread.
      ParkedActors parked;

      auto delegate = onMain([&] {
        return callNow(a, [&] {
          // In the actor, as if the JavaScript had called it.
          moduleState++;
          return a.lock().heldByCurrentThread() && Actor::current() == &a;
        });
      });
      mainHadIt = settled(delegate, "the main thread's delegate (deadlock)");
    }

    // Back from JavaScript, the call holds the actor again.
    jsHadItBack = a.lock().heldByCurrentThread() && moduleState == 2;
  });
  js.join();

  CHECK(mainHadIt.load() && jsHadItBack.load());

  // Deferred main entries borrow it too.
  std::atomic<bool> deferredRan{false};
  std::thread js2([&] {
    LucentScope call(a);
    ParkedActors parked;
    auto later = onMain([&] {
      enterFromMain(a, [&] { deferredRan = a.lock().heldByCurrentThread(); });
      return deferredRan.load();
    });
    CHECK(settled(later, "a deferred main entry while lent"));
  });
  js2.join();
  CHECK(deferredRan.load());
}

/// While the main thread has borrowed it, the lending thread waits to take
/// its actor back (JavaScript calling into the actor again), then goes on.
static void reenteringALentActorWaitsForTheBorrower() {
  Actor& a = Actor::create("reentered");
  std::atomic<bool> borrowed{false}, giveBack{false};
  std::atomic<int> order{0};
  std::atomic<int> mainLeft{0}, jsReentered{0};

  std::thread js([&] {
    LucentScope call(a);
    ParkedActors parked;

    auto delegate = onMain([&] {
      return callNow(a, [&] {
        borrowed = true;
        within(5000, [&] { return giveBack.load(); });
        mainLeft = ++order;
        return true;
      });
    });

    within(2000, [&] { return borrowed.load(); });

    // The callback's JavaScript calls the module again: after main leaves.
    std::thread release([&] {
      std::this_thread::sleep_for(std::chrono::milliseconds(30));
      giveBack = true;
    });
    {
      LucentScope again(a);
      jsReentered = ++order;
    }
    release.join();
    CHECK(settled(delegate, "the borrowing delegate"));
  });
  js.join();

  CHECK(mainLeft.load() == 1 && jsReentered.load() == 2);
}

// --- across actors ------------------------------------------------------------------

/// Two threads each holding one actor and waiting for the other's: one of
/// them is refused with an Error, never both waiting.
static void aCycleAcrossActorsThrows() {
  Actor& a = Actor::create("cycle-a");
  Actor& b = Actor::create("cycle-b");
  std::atomic<int> holding{0};
  std::atomic<int> refused{0}, entered{0};
  std::string message;
  std::mutex messageMutex;

  auto cross = [&](Actor& mine, Actor& theirs) {
    return std::thread([&] {
      LucentScope own(mine);
      holding++;
      within(2000, [&] { return holding.load() == 2; });

      try {
        LucentScope other(theirs);
        entered++;
      } catch (const Exception& e) {
        refused++;
        std::lock_guard<std::mutex> g(messageMutex);
        message = e.what();
      }
    });
  };

  std::thread one = cross(a, b);
  std::thread two = cross(b, a);
  auto joined = std::async(std::launch::async, [&] {
    one.join();
    two.join();
  });
  settled(joined, "two threads waiting for each other's actor");

  CHECK(refused.load() >= 1 && refused.load() + entered.load() == 2);
  CHECK(message.find("deadlock") != std::string::npos);

  // Nested entries that close no cycle wait as any other.
  std::atomic<bool> held{false};
  std::thread holder([&] {
    LucentScope scope(b);
    held = true;
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
  });
  CHECK(within(2000, [&] { return held.load(); }));
  {
    LucentScope inA(a);
    LucentScope inB(b);
    CHECK(b.lock().heldByCurrentThread());
  }
  holder.join();
}

int main() {
  actorsAreDistinct();
  aLongJobDelaysNeitherAnotherActorNorMain();
  mainFromModuleCodeRunsOnceTheActorIsFree();
  mainWaitsOnlyForTheHolder();
  aJavaScriptCallbackLendsItsActorToMain();
  reenteringALentActorWaitsForTheBorrower();
  aCycleAcrossActorsThrows();

  std::printf("actor: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
