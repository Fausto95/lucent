// Unit tests for native operations as promises (lucent/operation.h): a
// request native code completes on any thread, settled on the context that
// made it, cancelled by an AbortSignal or its scope, and whatever loses the
// race released rather than delivered. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
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

#include "lucent/lucent.h"
#include "lucent/operation.h"

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

  if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    std::fprintf(stderr, "a turn did not run within 5 s\n");
    std::abort();
  }
}

/// What a promise made on `owner` settled with, seen from the test thread.
template <class T>
struct Watched {
  std::atomic<int> settled{0};
  std::atomic<bool> fulfilled{false};
  std::atomic<bool> onOwner{false};
  /// Written before `settled`.
  std::string error;
  detail::Stored<T> value{};
};

/// Calls `start` in a turn of `owner` and watches the promise it returns.
template <class T, class Start>
static std::shared_ptr<Watched<T>> watch(ExecutionContext& owner, Start start) {
  auto watched = std::make_shared<Watched<T>>();

  inside(owner, [&] {
    Promise<T> promise = start();

    promise.onSettled([watched, promise, &owner] {
      watched->onOwner = owner.isCurrent();

      if (promise.fulfilled()) {
        watched->value = promise.value();
        watched->fulfilled = true;
      } else {
        watched->error = promise.error()->message.toUtf8();
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

/// Native work a test completes by hand, from its own thread.
template <class T>
struct Pending {
  std::mutex m;
  std::shared_ptr<Operation<T>> operation;
  std::atomic<int> started{0};
  /// How many times the native work was told to stop.
  std::atomic<int> stopped{0};

  /// The registration an operation starts with.
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

/// A result that counts its releases.
struct Probe : Object {
  static inline std::atomic<int> released{0};

  ~Probe() override { released++; }
};

// --- tests -------------------------------------------------------------------

static void settlesOnTheOwnerFromAnyThread() {
  auto owner = IsolatedContext::create();
  Pending<double> native;

  auto watched = watch<double>(*owner, [&] { return nativeOperation<double>(native.registration()); });
  CHECK(native.started == 1 && watched->settled == 0);

  std::thread([&] { native.op()->succeed(42); }).join();

  CHECK(settles(watched));
  CHECK(watched->fulfilled && watched->value == 42 && watched->onOwner);

  // The native work is over: told to stop once, which a completed call ignores.
  CHECK(within(2000, [&] { return native.stopped.load() == 1; }));

  owner->shutdown();
}

static void aFailureRejects() {
  auto owner = IsolatedContext::create();
  Pending<void> native;

  auto watched = watch<void>(*owner, [&] { return nativeOperation<void>(native.registration()); });
  std::thread([&] { native.op()->fail(makeError(str("thrown natively"))); }).join();

  CHECK(settles(watched));
  CHECK(!watched->fulfilled && watched->error == "thrown natively" && watched->onOwner);

  owner->shutdown();
}

static void aRegistrationThatThrowsRejects() {
  auto owner = IsolatedContext::create();

  auto watched = watch<double>(*owner, [] {
    return nativeOperation<double>([](const std::shared_ptr<Operation<double>>&) -> std::function<void()> {
      throw Exception(makeError(str("could not start")));
    });
  });

  CHECK(settles(watched));
  CHECK(!watched->fulfilled && watched->error == "could not start");

  owner->shutdown();
}

static void anAbortedSignalNeverStartsIt() {
  auto owner = IsolatedContext::create();
  Pending<double> native;
  AbortController controller;

  inside(*owner, [&] {
    controller = std::make_shared<AbortControllerObject>();
    controller->abort(makeError(str("AbortError"), str("not wanted")));
  });

  auto watched = watch<double>(*owner, [&] {
    return nativeOperation<double>(native.registration(), controller->signal);
  });

  CHECK(settles(watched));
  CHECK(!watched->fulfilled && watched->error == "not wanted");
  CHECK(native.started == 0);

  owner->shutdown();
}

static void abortingCancelsAndReleasesALateResult() {
  auto owner = IsolatedContext::create();
  Pending<Ref<Probe>> native;
  AbortController controller;

  inside(*owner, [&] { controller = std::make_shared<AbortControllerObject>(); });

  auto watched = watch<Ref<Probe>>(*owner, [&] {
    return nativeOperation<Ref<Probe>>(native.registration(), controller->signal);
  });
  CHECK(native.started == 1);

  inside(*owner, [&] { controller->abort(makeError(str("AbortError"), str("stop"))); });

  CHECK(settles(watched));
  CHECK(!watched->fulfilled && watched->error == "stop" && watched->onOwner);
  CHECK(native.stopped == 1);

  // The native work finishes anyway: its result is released, never delivered.
  int before = Probe::released;
  std::thread([&] { CHECK(!native.op()->succeed(std::make_shared<Probe>())); }).join();

  CHECK(Probe::released == before + 1);
  CHECK(native.op()->lateOutcomes() == 1);
  CHECK(watched->settled == 1);

  owner->shutdown();
}

static void aSettledOperationLeavesTheSignal() {
  auto owner = IsolatedContext::create();
  Pending<double> native;
  AbortController controller;

  inside(*owner, [&] { controller = std::make_shared<AbortControllerObject>(); });

  auto watched = watch<double>(*owner, [&] {
    return nativeOperation<double>(native.registration(), controller->signal);
  });
  std::thread([&] { native.op()->succeed(1); }).join();
  CHECK(settles(watched) && watched->fulfilled);

  // Aborting afterwards changes nothing: the listener left with the outcome.
  inside(*owner, [&] { controller->abort(makeError(str("AbortError"), str("too late"))); });
  CHECK(within(2000, [&] { return native.stopped.load() == 1; }));
  CHECK(native.op()->lateOutcomes() == 0 && watched->settled == 1);

  owner->shutdown();
}

static void disposingTheScopeCancels() {
  auto owner = IsolatedContext::create();
  Pending<double> native;

  auto watched = watch<double>(*owner, [&] { return nativeOperation<double>(native.registration()); });
  CHECK(native.started == 1);

  // The context's root scope goes with it: the native work is told to stop.
  owner->shutdown();
  CHECK(owner->waitStopped(5000));
  CHECK(native.stopped == 1);
  CHECK(native.op()->state() == OperationState::Cancelled);

  // A result arriving now is dropped.
  CHECK(!native.op()->succeed(7));
}

int main() {
  settlesOnTheOwnerFromAnyThread();
  aFailureRejects();
  aRegistrationThatThrowsRejects();
  anAbortedSignalNeverStartsIt();
  abortingCancelsAndReleasesALateResult();
  aSettledOperationLeavesTheSignal();
  disposingTheScopeCancels();

  std::printf("operation: %d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
