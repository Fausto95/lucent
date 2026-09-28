// Unit tests for composing callbacks into promises and subscriptions
// (lucent/callback.h): exactly-once settlement and cleanup, the signal, the
// owner's scope, and calls from other threads. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan;
// LUCENT_RACE_ITERATIONS sets how often each race runs.
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "lucent/callback.h"
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

static String str(const char* s) { return String::fromUtf8(s); }

static Error E(const char* name, const char* message = "") { return makeError(str(name), str(message)); }

static int iterations() {
  const char* n = std::getenv("LUCENT_RACE_ITERATIONS");
  return n ? std::atoi(n) : 200;
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

/// What happened, in order, from any thread.
class Log {
 public:
  void add(std::string entry) {
    std::lock_guard<std::mutex> g(m_);
    entries_.push_back(std::move(entry));
  }

  std::string text() const {
    std::lock_guard<std::mutex> g(m_);
    std::string out;
    for (const auto& e : entries_) out += (out.empty() ? "" : ", ") + e;
    return out;
  }

  size_t count(const std::string& entry) const {
    std::lock_guard<std::mutex> g(m_);
    size_t n = 0;
    for (const auto& e : entries_) n += e == entry;
    return n;
  }

 private:
  mutable std::mutex m_;
  std::vector<std::string> entries_;
};

/// Logs the promise's outcome on the context it resumes on.
template <class T>
static void logOutcome(const Promise<T>& promise, const std::shared_ptr<Log>& log) {
  promise.onSettled([promise, log] {
    if (!promise.fulfilled()) {
      log->add("rejected " + promise.error()->name.toUtf8());
    } else if constexpr (std::is_same_v<T, double>) {
      log->add("resolved " + std::to_string(static_cast<int>(promise.value())));
    } else {
      log->add("resolved");
    }
  });
}

/// What a registration returns: the cleanup that stops listening, if any.
using Cleanup = Opt<Fn<void()>>;

/// A cleanup that logs itself.
static Cleanup cleanup(const std::shared_ptr<Log>& log, const char* entry = "cleanup") {
  return Fn<void()>([log, entry] { log->add(entry); });
}

using Resolve = Fn<void(double)>;
using Reject = Fn<void(Error)>;
using Registration = Fn<Cleanup(Resolve, Reject)>;

// --- fromCallback -------------------------------------------------------------

static void settlesOnceAndCleansUpOnce() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();
  Resolve resolve;
  Reject reject;

  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve res, Reject rej) {
      resolve = res;
      reject = rej;
      log->add("registered");
      return cleanup(log);
    }));
    logOutcome(p, log);
    log->add("returned");
  });

  inside(*a, [&] {
    resolve(1);
    log->add("after resolve");
    resolve(2);
    reject(E("TypeError"));
  });
  CHECK(a->waitIdle(2000));

  // The cleanup runs inside the call that settles it; the continuation later.
  CHECK(log->text() == "registered, returned, cleanup, after resolve, resolved 1");

  a->shutdown();
}

static void completionDuringRegistration() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();

  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve resolve, Reject) {
      resolve(7);
      log->add("resolved during registration");
      resolve(8);
      return cleanup(log);
    }));
    log->add("returned");
    logOutcome(p, log);
  });
  CHECK(a->waitIdle(2000));

  // Settled before its cleanup existed: it runs as soon as it is returned.
  CHECK(log->text() == "resolved during registration, cleanup, returned, resolved 7");

  a->shutdown();
}

static void registrationThatThrows() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();
  Resolve resolve;

  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve res, Reject) -> Cleanup {
      resolve = res;
      throwError(E("RangeError"));
    }));
    logOutcome(p, log);
  });
  inside(*a, [&] { resolve(1); });
  CHECK(a->waitIdle(2000));

  CHECK(log->text() == "rejected RangeError");

  // Settled before it threw: the throw is ignored, as a Promise executor's.
  auto after = std::make_shared<Log>();
  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve res, Reject) -> Cleanup {
      res(3);
      throwError(E("RangeError"));
    }));
    logOutcome(p, after);
  });
  CHECK(a->waitIdle(2000));

  CHECK(after->text() == "resolved 3");

  a->shutdown();
}

static void signals() {
  auto a = IsolatedContext::create();

  // Already aborted: rejected with its reason, never registered.
  auto early = std::make_shared<Log>();
  inside(*a, [&] {
    AbortController c = std::make_shared<AbortControllerObject>();
    c->abort(E("TimeoutError"));
    auto p = fromCallback<double>(Registration([&](Resolve, Reject) {
      early->add("registered");
      return cleanup(early);
    }), c->signal);
    logOutcome(p, early);
  });
  CHECK(a->waitIdle(2000));
  CHECK(early->text() == "rejected TimeoutError");

  // Aborted while pending: rejected, cleaned up at once; later calls dropped.
  auto later = std::make_shared<Log>();
  AbortController controller;
  Resolve resolve;
  inside(*a, [&] {
    controller = std::make_shared<AbortControllerObject>();
    auto p = fromCallback<double>(Registration([&](Resolve res, Reject) {
      resolve = res;
      return cleanup(later);
    }), controller->signal);
    logOutcome(p, later);
  });
  inside(*a, [&] {
    controller->abort(undefined);
    later->add("aborted");
    resolve(1);
  });
  CHECK(a->waitIdle(2000));
  CHECK(later->text() == "cleanup, aborted, rejected AbortError");

  // Aborted during registration.
  auto during = std::make_shared<Log>();
  inside(*a, [&] {
    AbortController c = std::make_shared<AbortControllerObject>();
    auto p = fromCallback<double>(Registration([&](Resolve, Reject) {
      c->abort(undefined);
      during->add("aborted");
      return cleanup(during);
    }), c->signal);
    logOutcome(p, during);
  });
  CHECK(a->waitIdle(2000));
  CHECK(during->text() == "aborted, cleanup, rejected AbortError");

  // Aborted after settlement: nothing changes.
  auto settled = std::make_shared<Log>();
  inside(*a, [&] {
    AbortController c = std::make_shared<AbortControllerObject>();
    c->signal->addEventListener([settled] { settled->add("abort listener"); });
    auto p = fromCallback<double>(Registration([&](Resolve res, Reject) {
      res(5);
      return cleanup(settled);
    }), c->signal);
    logOutcome(p, settled);
    c->abort(undefined);
  });
  CHECK(a->waitIdle(2000));
  CHECK(settled->text() == "cleanup, abort listener, resolved 5");

  a->shutdown();
}

static void cleanupErrorsAreReported() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();
  Reject reject;

  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve, Reject rej) {
      reject = rej;
      return Cleanup(Fn<void()>([] { throwError(E("CleanupError")); }));
    }));
    logOutcome(p, log);
  });

  StderrCapture capture;
  inside(*a, [&] {
    reject(E("SyntaxError"));
    log->add("reject returned");
  });
  CHECK(a->waitIdle(2000));
  std::string reported = capture.finish();

  // Never thrown to whoever settled it; the outcome stays.
  CHECK(log->text() == "reject returned, rejected SyntaxError");
  CHECK(reported.find("uncaught exception in operation") != std::string::npos);

  a->shutdown();
}

static void voidValues() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();

  inside(*a, [&] {
    auto p = fromCallback<void>(Fn<Cleanup(Fn<void()>, Reject)>([&](Fn<void()> resolve, Reject) {
      resolve();
      return Cleanup(undefined);
    }));
    logOutcome(p, log);

    auto q = fromCallback<void>(Fn<Cleanup(Fn<void(Undefined)>, Reject)>([&](Fn<void(Undefined)> resolve, Reject) {
      resolve(undefined);
      return Cleanup(undefined);
    }));
    logOutcome(q, log);
  });
  CHECK(a->waitIdle(2000));

  CHECK(log->text() == "resolved, resolved");

  a->shutdown();
}

/// A registration returns its cleanup as it declares it: a function,
/// maybe absent, or nothing. What a cleanup or a value handler returns is
/// ignored.
static void registrationShapes() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();

  inside(*a, [&] {
    auto none = fromCallback<double>(Fn<void(Resolve, Reject)>([](Resolve resolve, Reject) { resolve(1); }));
    logOutcome(none, log);

    auto valued = fromCallback<double>(Fn<Fn<double()>(Resolve, Reject)>([log](Resolve resolve, Reject) {
      resolve(2);
      return Fn<double()>([log] {
        log->add("valued cleanup");
        return 0.0;
      });
    }));
    logOutcome(valued, log);

    auto absent = fromCallback<double>(Registration([](Resolve resolve, Reject) {
      resolve(3);
      return Cleanup(undefined);
    }));
    logOutcome(absent, log);

    auto counted = subscribe(Fn<void(Fn<void(double)>, Fn<void()>, Reject)>([](Fn<void(double)> next, Fn<void()> end, Reject) {
      next(4);
      end();
    }), Fn<double(double)>([log](double v) {
      log->add("value " + std::to_string(static_cast<int>(v)));
      return v;
    }));
    logOutcome(counted, log);
  });
  CHECK(a->waitIdle(2000));

  CHECK(log->text() == "valued cleanup, value 4, resolved 1, resolved 2, resolved 3, resolved");

  a->shutdown();
}

static void scopeDisposalCancels() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();
  std::atomic<bool> cleanedOnA{false};

  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve, Reject) {
      return Cleanup(Fn<void()>([&cleanedOnA, a = a.get(), log] {
        cleanedOnA = a->isCurrent();
        log->add("cleanup");
      }));
    }));
    p.onSettled([p, log] { log->add(p.fulfilled() ? "resolved" : "rejected " + p.error()->name.toUtf8()); });
  });

  // The context's root scope is disposed on its thread; its microtasks
  // (the continuation) no longer run.
  a->shutdown();
  CHECK(a->waitStopped(2000));

  CHECK(log->count("cleanup") == 1);
  CHECK(cleanedOnA.load());
}

// --- subscribe ----------------------------------------------------------------

using Next = Fn<void(double)>;
using End = Fn<void()>;
using Subscription = Fn<Cleanup(Next, End, Reject)>;

static Next logValues(const std::shared_ptr<Log>& log) {
  return [log](double v) { log->add("value " + std::to_string(static_cast<int>(v))); };
}

static void deliversUntilItEnds() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();
  Next next;
  End end;

  inside(*a, [&] {
    auto p = subscribe(Subscription([&](Next n, End e, Reject) {
      n(1);
      next = n;
      end = e;
      return cleanup(log);
    }), logValues(log));
    logOutcome(p, log);
  });
  inside(*a, [&] {
    next(2);
    next(3);
    end();
    next(4);
    end();
  });
  CHECK(a->waitIdle(2000));

  CHECK(log->text() == "value 1, value 2, value 3, cleanup, resolved");

  a->shutdown();
}

static void subscriptionFailures() {
  auto a = IsolatedContext::create();

  // A throwing handler ends it with that error.
  auto thrown = std::make_shared<Log>();
  Next next;
  inside(*a, [&] {
    auto p = subscribe(Subscription([&](Next n, End, Reject) {
      next = n;
      return cleanup(thrown);
    }), Next([thrown](double v) {
      thrown->add("value");
      if (v > 1) throwError(E("DataError"));
    }));
    logOutcome(p, thrown);
  });
  inside(*a, [&] {
    next(1);
    next(2);
    next(3);
  });
  CHECK(a->waitIdle(2000));
  CHECK(thrown->text() == "value, value, cleanup, rejected DataError");

  // fail() rejects; abort rejects with the reason.
  auto failed = std::make_shared<Log>();
  auto aborted = std::make_shared<Log>();
  AbortController controller;
  inside(*a, [&] {
    auto p = subscribe(Subscription([&](Next, End, Reject fail) {
      fail(E("NotFoundError"));
      return cleanup(failed);
    }), logValues(failed));
    logOutcome(p, failed);

    controller = std::make_shared<AbortControllerObject>();
    auto q = subscribe(Subscription([&](Next n, End, Reject) {
      n(1);
      return cleanup(aborted);
    }), logValues(aborted), controller->signal);
    logOutcome(q, aborted);
  });
  inside(*a, [&] { controller->abort(E("TimeoutError")); });
  CHECK(a->waitIdle(2000));
  CHECK(failed->text() == "cleanup, rejected NotFoundError");
  CHECK(aborted->text() == "value 1, cleanup, rejected TimeoutError");

  a->shutdown();
}

// --- other threads ------------------------------------------------------------

static void callsFromAnotherThreadRunOnTheOwner() {
  auto a = IsolatedContext::create();
  auto log = std::make_shared<Log>();
  std::atomic<int> offOwner{0};

  auto onA = [&, owner = a.get()](const char* what) {
    if (!owner->isCurrent()) offOwner++;
    log->add(what);
  };

  inside(*a, [&] {
    auto p = subscribe(Subscription([&](Next next, End end, Reject) {
      // A native listener delivering on its own thread.
      std::thread([next, end] {
        for (int i = 1; i <= 50; i++) next(i);
        end();
        next(51);
      }).detach();
      return Cleanup(Fn<void()>([onA] { onA("cleanup"); }));
    }), Next([onA](double) { onA("value"); }));
    p.onSettled([p, onA] { onA(p.fulfilled() ? "resolved" : "rejected"); });
  });

  CHECK(within(2000, [&] { return log->count("resolved") == 1; }));
  CHECK(a->waitIdle(2000));

  // In the order they were called, on the owner, and nothing after the end.
  CHECK(log->count("value") == 50);
  CHECK(log->count("cleanup") == 1);
  CHECK(offOwner == 0);

  auto once = std::make_shared<Log>();
  inside(*a, [&] {
    auto p = fromCallback<double>(Registration([&](Resolve resolve, Reject) {
      std::thread([resolve] { resolve(9); }).detach();
      return Cleanup(Fn<void()>([once, owner = a.get()] { once->add(owner->isCurrent() ? "cleanup on owner" : "cleanup elsewhere"); }));
    }));
    logOutcome(p, once);
  });
  CHECK(within(2000, [&] { return once->count("resolved 9") == 1; }));
  CHECK(once->text() == "cleanup on owner, resolved 9");

  a->shutdown();
}

static void legacyModuleContext() {
  auto log = std::make_shared<Log>();

  {
    LucentScope scope;
    auto p = fromCallback<double>(Registration([&](Resolve resolve, Reject) {
      std::thread([resolve] { resolve(4); }).detach();
      return Cleanup(Fn<void()>([log] { log->add(Scheduler::lock().heldByCurrentThread() ? "cleanup locked" : "cleanup unlocked"); }));
    }));
    logOutcome(p, log);
  }

  CHECK(within(2000, [&] { return log->count("resolved 4") == 1; }));
  CHECK(Scheduler::instance().waitIdle(2000));
  CHECK(log->text() == "cleanup locked, resolved 4");
}

/// Settlement from other threads racing an abort and a disposal on the
/// owner: one outcome, one cleanup, on the owner, every time.
static void settlementRaces() {
  int n = iterations();
  int bad = 0;

  for (int i = 0; i < n; i++) {
    auto a = IsolatedContext::create();
    auto log = std::make_shared<Log>();
    std::atomic<int> cleanups{0};
    std::atomic<int> offOwner{0};
    Resolve resolve;
    Reject reject;
    AbortController controller;

    inside(*a, [&] {
      controller = std::make_shared<AbortControllerObject>();
      auto p = fromCallback<double>(Registration([&, owner = a.get()](Resolve res, Reject rej) {
        resolve = res;
        reject = rej;
        return Cleanup(Fn<void()>([&cleanups, &offOwner, owner] {
          if (!owner->isCurrent()) offOwner++;
          cleanups++;
        }));
      }), controller->signal);
      logOutcome(p, log);
    });

    std::atomic<bool> go{false};
    std::thread t1([&] {
      while (!go) std::this_thread::yield();
      resolve(1);
    });
    std::thread t2([&] {
      while (!go) std::this_thread::yield();
      reject(E("TypeError"));
    });
    std::thread t3([&] {
      while (!go) std::this_thread::yield();
      controller->abort(undefined);
    });
    go = true;
    t1.join();
    t2.join();
    t3.join();

    bool settled = within(2000, [&] { return log->text().size() > 0; });
    a->waitIdle(2000);
    std::string outcome = log->text();

    bool one = outcome == "resolved 1" || outcome == "rejected TypeError" || outcome == "rejected AbortError";
    if (!settled || !one || cleanups != 1 || offOwner != 0) {
      bad++;
      std::fprintf(stderr, "race %d: outcome=%s cleanups=%d offOwner=%d\n", i, outcome.c_str(), cleanups.load(), offOwner.load());
    }

    a->shutdown();
    a->waitStopped(2000);
  }

  CHECK(bad == 0);
}

int main() {
  settlesOnceAndCleansUpOnce();
  completionDuringRegistration();
  registrationThatThrows();
  signals();
  cleanupErrorsAreReported();
  voidValues();
  registrationShapes();
  scopeDisposalCancels();
  deliversUntilItEnds();
  subscriptionFailures();
  callsFromAnotherThreadRunOnTheOwner();
  legacyModuleContext();
  settlementRaces();

  std::printf("callback: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
