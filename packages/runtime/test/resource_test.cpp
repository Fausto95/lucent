// Unit tests for resources (lucent/resource.h): open, closing and closed,
// a release that runs once on the thread it requires, and the ways a
// resource closes. Built and run by `packages/runtime/test/run.sh`, also
// under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "lucent/lucent.h"
#include "lucent/resource.h"

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

/// Blocks until the main thread has run what was posted to it before.
static bool mainCaughtUp() {
  auto done = std::make_shared<std::atomic<bool>>(false);
  postToMain([done] { *done = true; });

  return within(2000, [&] { return done->load(); });
}

/// The error `f` throws: name and message, or empty if it throws none.
template <class F>
static std::string thrown(F f) {
  try {
    f();
  } catch (const Exception& e) {
    return e.error()->name.toUtf8() + ": " + e.error()->message.toUtf8();
  }

  return "";
}

static String S(const char* s) { return String::fromUtf8(s); }

static int raceIterations() {
  const char* n = std::getenv("LUCENT_RACE_ITERATIONS");
  return n ? std::atoi(n) : 200;
}

// --- states -----------------------------------------------------------------

/// Open until closed; the first close releases, and every later one is
/// harmless. Using it after that throws one consistent error.
static void closesOnce() {
  int released = 0;
  auto camera = Resource::open(S("Camera"), [&] { released++; });

  CHECK(camera->state() == Resource::State::Open && camera->isOpen());
  CHECK(thrown([&] { camera->check(); }) == "");

  CHECK(camera->close());
  CHECK(released == 1 && camera->state() == Resource::State::Closed);

  CHECK(!camera->close());
  CHECK(released == 1);
  CHECK(thrown([&] { camera->check(); }) == "InvalidStateError: Camera is closed");
}

/// While its release runs, a resource is closing: it refuses use, and a
/// close from the release itself returns at once.
static void closingRefusesUse() {
  std::shared_ptr<Resource> file;
  Resource::State during = Resource::State::Open;
  std::string use;
  bool again = true;

  file = Resource::open(S("File"), [&] {
    during = file->state();
    use = thrown([&] { file->check(); });
    again = file->close();
  });

  CHECK(file->close());
  CHECK(during == Resource::State::Closing);
  CHECK(use == "InvalidStateError: File is closed");
  CHECK(!again && file->state() == Resource::State::Closed);
}

/// A release that throws still closes the resource; its error reaches the
/// caller that closed it.
static void releaseErrorsStillClose() {
  auto socket = Resource::open(S("Socket"), [] { throwError(makeError(S("NetworkError"), S("reset"))); });

  CHECK(thrown([&] { socket->close(); }) == "NetworkError: reset");
  CHECK(socket->state() == Resource::State::Closed);
  CHECK(!socket->close());

  bool refused = false;
  try {
    Resource::open(S("Nothing"), nullptr);
  } catch (const std::invalid_argument&) {
    refused = true;
  }
  CHECK(refused);
}

// --- the required thread ----------------------------------------------------

/// A resource that must be released on the main thread is, whoever closes
/// it: in place there, else posted, closing until the release has run.
static void releaseRunsOnItsContext() {
  ExecutionContext& main = ExecutionContext::main();
  std::atomic<int> onMain{0}, released{0};
  auto release = [&] {
    if (onMainThread()) onMain++;
    released++;
  };

  auto view = Resource::open(S("View"), release, &main);

  CHECK(view->close());
  CHECK(mainCaughtUp());
  CHECK(released == 1 && onMain == 1);
  CHECK(view->state() == Resource::State::Closed);

  std::atomic<bool> closedInPlace{false};
  postToMain([&] {
    auto layer = Resource::open(S("Layer"), release, &main);
    layer->close();
    closedInPlace = layer->state() == Resource::State::Closed && released == 2;
  });

  CHECK(mainCaughtUp());
  CHECK(closedInPlace && onMain == 2);
}

/// Finalization is a backstop: the last reference closes an open resource,
/// on the thread it requires, whichever thread dropped it.
static void lastReferenceClosesIt() {
  ExecutionContext& main = ExecutionContext::main();
  std::atomic<int> onMain{0}, released{0};

  {
    auto sensor = Resource::open(
        S("Sensor"),
        [&] {
          if (onMainThread()) onMain++;
          released++;
        },
        &main);

    std::thread([moved = std::move(sensor)]() mutable { moved.reset(); }).join();
  }

  CHECK(mainCaughtUp());
  CHECK(released == 1 && onMain == 1);

  // A closed one releases nothing more.
  {
    auto closed = Resource::open(S("Closed"), [&] { released++; });
    closed->close();
  }
  CHECK(released == 2);
}

// --- scopes -----------------------------------------------------------------

/// Disposing the scope a resource belongs to closes it.
static void scopeDisposalClosesIt() {
  auto scope = Scope::create(1);
  int released = 0;

  auto session = Resource::open(S("Session"), [&] { released++; }, nullptr, scope);

  CHECK(scope->dispose() == nullptr);
  CHECK(released == 1 && session->state() == Resource::State::Closed);

  // Opened under a disposed scope: closed at once.
  auto late = Resource::open(S("Late"), [&] { released++; }, nullptr, scope);
  CHECK(released == 2 && late->state() == Resource::State::Closed);
}

/// The scope refers to a resource weakly: it never keeps it alive, and a
/// resource that closes or goes first leaves nothing registered there.
static void scopesHoldResourcesWeakly() {
  auto scope = Scope::create(1);
  int released = 0;

  auto kept = Resource::open(S("Kept"), [&] { released++; }, nullptr, scope);
  std::weak_ptr<Resource> watch = kept;

  CHECK(scope->registrations() == 1);

  kept.reset();
  CHECK(watch.expired() && released == 1);
  CHECK(scope->registrations() == 0);

  auto closed = Resource::open(S("Closed"), [&] { released++; }, nullptr, scope);
  closed->close();
  CHECK(released == 2 && scope->registrations() == 0);

  scope->dispose();
  CHECK(released == 2);
}

/// Closing, disposing the scope and dropping the last reference race from
/// several threads: the release runs exactly once.
static void closeRaces() {
  int bad = 0;

  for (int i = 0; i < raceIterations(); i++) {
    auto scope = Scope::create(1);
    std::atomic<int> released{0};
    auto r = Resource::open(S("Raced"), [&] { released++; }, nullptr, scope);
    std::weak_ptr<Resource> watch = r;
    std::atomic<int> won{0};

    std::atomic<bool> go{false};
    std::vector<std::thread> threads;
    threads.emplace_back([&, copy = r] {
      while (!go) std::this_thread::yield();
      if (copy->close()) won++;
    });
    threads.emplace_back([&, copy = r] {
      while (!go) std::this_thread::yield();
      if (copy->close()) won++;
    });
    threads.emplace_back([&] {
      while (!go) std::this_thread::yield();
      scope->dispose();
    });
    r.reset();

    go = true;
    for (auto& t : threads) t.join();

    if (released != 1 || won > 1 || !watch.expired()) bad++;
  }

  CHECK(bad == 0);
}

int main() {
  closesOnce();
  closingRefusesUse();
  releaseErrorsStillClose();
  releaseRunsOnItsContext();
  lastReferenceClosesIt();
  scopeDisposalClosesIt();
  scopesHoldResourcesWeakly();
  closeRaces();

  std::printf("resource: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
