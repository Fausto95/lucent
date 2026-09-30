// Unit tests for the requests Android answers later (activity results and
// permissions, lucent/platform/android_requests.h): each settles its promise
// exactly once, on the context that asked, and one cancelled (an aborted
// signal, a disposed scope) is forgotten on the platform side, so a late
// answer is dropped. Built and run by `packages/runtime/test/run.sh`, also
// under ASan/UBSan and TSan. No JNI: the platform side is a function.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "lucent/lucent.h"
#include "lucent/platform/android_requests.h"

using namespace lucent;
using lucent::jni::Requests;

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

/// Runs `f` as a turn of `context` and returns its result.
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

/// What a promise settled with, seen from the test thread.
template <class T>
struct Watched {
  std::atomic<int> settled{0};
  std::atomic<bool> fulfilled{false};
  std::atomic<bool> onOwner{false};
  std::string error;
  detail::Stored<T> value{};
};

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
        watched->error = promise.error()->name.toUtf8();
      }

      watched->settled++;
    });
  });

  return watched;
}

template <class T>
static bool settles(const std::shared_ptr<Watched<T>>& w) {
  return within(5000, [&] { return w->settled.load() > 0; });
}

/// The platform side: what was launched and what was forgotten, by id.
struct Platform {
  std::mutex m;
  std::vector<OperationId> launched;
  std::vector<OperationId> forgotten;

  OperationId last() {
    std::lock_guard<std::mutex> g(m);
    return launched.empty() ? 0 : launched.back();
  }

  size_t forgets() {
    std::lock_guard<std::mutex> g(m);
    return forgotten.size();
  }
};

static void anAnswerSettlesOnceOnTheContextThatAsked() {
  auto owner = IsolatedContext::create();
  auto platform = std::make_shared<Platform>();
  Requests<double> requests([platform](OperationId id) {
    std::lock_guard<std::mutex> g(platform->m);
    platform->forgotten.push_back(id);
  });

  auto asked = watch<double>(*owner, [&] {
    return requests.start(owner->root(), {}, [&](OperationId id) { platform->launched.push_back(id); });
  });

  OperationId id = platform->last();
  CHECK(id != 0 && requests.pending() == 1);

  // The platform answers on its own thread (Android's main thread).
  std::thread([&] { CHECK(requests.deliver(id, 42)); }).join();

  CHECK(settles(asked));
  CHECK(asked->fulfilled && asked->value == 42 && asked->onOwner);

  // A repeated or late answer is dropped; an answered request is not "forgotten".
  CHECK(!requests.deliver(id, 7));
  CHECK(!requests.fail(id, makeError(String::fromLatin1("Error"), String::fromLatin1("late"))));
  CHECK(asked->settled == 1 && requests.pending() == 0 && platform->forgets() == 0);

  owner->shutdown();
}

static void concurrentRequestsAreAnsweredApart() {
  auto owner = IsolatedContext::create();
  auto platform = std::make_shared<Platform>();
  Requests<double> requests([](OperationId) {});

  auto launch = [&](OperationId id) { platform->launched.push_back(id); };
  auto first = watch<double>(*owner, [&] { return requests.start(owner->root(), {}, launch); });
  OperationId a = platform->last();
  auto second = watch<double>(*owner, [&] { return requests.start(owner->root(), {}, launch); });
  OperationId b = platform->last();

  CHECK(a != b && requests.pending() == 2);

  CHECK(requests.deliver(b, 2));
  CHECK(requests.deliver(a, 1));

  CHECK(settles(first) && settles(second));
  CHECK(first->value == 1 && second->value == 2);

  owner->shutdown();
}

static void aPlatformFailureRejects() {
  auto owner = IsolatedContext::create();
  auto platform = std::make_shared<Platform>();
  Requests<double> requests([](OperationId) {});

  auto asked = watch<double>(*owner, [&] {
    return requests.start(owner->root(), {}, [&](OperationId id) { platform->launched.push_back(id); });
  });

  Error noActivity = makeError(String::fromLatin1("Error"), String::fromLatin1("no Activity"));
  noActivity->code = String::fromLatin1("ERR_NO_ACTIVITY");
  CHECK(requests.fail(platform->last(), noActivity));

  CHECK(settles(asked));
  CHECK(!asked->fulfilled && asked->error == "Error" && requests.pending() == 0);

  owner->shutdown();
}

static void anAbortedSignalCancelsAndForgets() {
  auto owner = IsolatedContext::create();
  auto platform = std::make_shared<Platform>();
  Requests<double> requests([platform](OperationId id) {
    std::lock_guard<std::mutex> g(platform->m);
    platform->forgotten.push_back(id);
  });

  AbortController controller;
  auto asked = watch<double>(*owner, [&] {
    controller = std::make_shared<AbortControllerObject>();
    return requests.start(owner->root(), controller->signal, [&](OperationId id) { platform->launched.push_back(id); });
  });
  OperationId id = platform->last();

  inside(*owner, [&] { controller->abort({}); });

  CHECK(settles(asked));
  CHECK(!asked->fulfilled && asked->error == "AbortError");
  CHECK(within(2000, [&] { return platform->forgets() == 1; }));
  CHECK(platform->forgotten.at(0) == id);

  // The platform's answer after the cancellation (its dialog stayed open) is dropped.
  CHECK(!requests.deliver(id, 1) && requests.pending() == 0 && asked->settled == 1);

  owner->shutdown();
}

static void anAlreadyAbortedSignalLaunchesNothing() {
  auto owner = IsolatedContext::create();
  bool launched = false;
  Requests<double> requests([](OperationId) {});

  auto asked = watch<double>(*owner, [&] {
    auto controller = std::make_shared<AbortControllerObject>();
    controller->abort({});
    return requests.start(owner->root(), controller->signal, [&](OperationId) { launched = true; });
  });

  CHECK(settles(asked));
  CHECK(!asked->fulfilled && asked->error == "AbortError" && !launched && requests.pending() == 0);

  owner->shutdown();
}

static void aDisposedScopeCancelsAndForgets() {
  auto owner = IsolatedContext::create();
  auto platform = std::make_shared<Platform>();
  Requests<double> requests([platform](OperationId id) {
    std::lock_guard<std::mutex> g(platform->m);
    platform->forgotten.push_back(id);
  });

  std::shared_ptr<Scope> scope;
  auto asked = watch<double>(*owner, [&] {
    scope = Scope::create(0, owner->root());
    return requests.start(scope, {}, [&](OperationId id) { platform->launched.push_back(id); });
  });

  inside(*owner, [&] { scope->dispose(); });

  CHECK(settles(asked));
  CHECK(!asked->fulfilled && asked->error == "AbortError");
  CHECK(within(2000, [&] { return platform->forgets() == 1; }));
  CHECK(!requests.deliver(platform->last(), 1));

  owner->shutdown();
}

static void aLaunchThatThrowsRejects() {
  auto owner = IsolatedContext::create();
  Requests<double> requests([](OperationId) {});

  auto asked = watch<double>(*owner, [&] {
    return requests.start(owner->root(), {}, [](OperationId) { throwTypeError("no such Intent"); });
  });

  CHECK(settles(asked));
  CHECK(!asked->fulfilled && asked->error == "TypeError" && requests.pending() == 0);

  owner->shutdown();
}

int main() {
  anAnswerSettlesOnceOnTheContextThatAsked();
  concurrentRequestsAreAnsweredApart();
  aPlatformFailureRejects();
  anAbortedSignalCancelsAndForgets();
  anAlreadyAbortedSignalLaunchesNothing();
  aDisposedScopeCancelsAndForgets();
  aLaunchThatThrowsRejects();

  std::printf("android requests: %d/%d checks passed\n", checks - failures, checks);

  return failures ? 1 : 0;
}
