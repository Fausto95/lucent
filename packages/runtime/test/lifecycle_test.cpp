// Unit tests for the app's and its scenes' lifecycle (lucent/lifecycle.h)
// and presentations (lucent/presentation.h): what the platform reports,
// subscriptions that end with their scope, the scene to present from, and
// a presentation that settles exactly once, however it ends. The host's
// stand-in main thread plays UIKit's. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "lucent/lifecycle.h"
#include "lucent/lucent.h"
#include "lucent/presentation.h"

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

/// Runs `f` on the main thread, as the platform's notifications do, and
/// waits for it. What it throws is rethrown here.
template <class F>
static void onMain(F f) {
  auto done = std::make_shared<std::atomic<bool>>(false);
  auto error = std::make_shared<std::exception_ptr>();

  postToMain([&f, done, error] {
    try {
      f();
    } catch (...) {
      *error = std::current_exception();
    }
    done->store(true);
  });

  if (!within(5000, [&] { return done->load(); })) {
    std::fprintf(stderr, "the main thread did not run the job\n");
    std::abort();
  }

  if (*error) std::rethrow_exception(*error);
}

/// Blocks until the main thread has run what was posted to it before.
static bool mainCaughtUp() {
  auto done = std::make_shared<std::atomic<bool>>(false);
  postToMain([done] { *done = true; });

  return within(2000, [&] { return done->load(); });
}

static bool moduleCaughtUp() { return Actor::shared().waitIdle(2000); }

static std::string describe(const Error& e) { return e ? e->name.toUtf8() + ": " + e->message.toUtf8() : ""; }

/// The error `f` throws: name and message, or empty if it throws none.
template <class F>
static std::string thrown(F f) {
  try {
    f();
  } catch (const Exception& e) {
    return describe(e.error());
  } catch (const std::logic_error& e) {
    return std::string("logic_error: ") + e.what();
  }

  return "";
}

static int raceIterations() {
  const char* n = std::getenv("LUCENT_RACE_ITERATIONS");
  return n ? std::atoi(n) : 200;
}

// --- scenes -------------------------------------------------------------------

/// The platform reports scenes on the main thread only: anywhere else is a
/// caller bug.
static void reportsComeFromTheMainThread() {
  Lifecycle lifecycle;

  CHECK(thrown([&] { lifecycle.connect(); }).rfind("logic_error", 0) == 0);
  CHECK(thrown([&] { lifecycle.report(AppEvent::DidBecomeActive); }).rfind("logic_error", 0) == 0);
  CHECK(lifecycle.scenes().empty());
}

/// Connected scenes come most recently activated first; each has its own
/// never-reused id, and a disconnected one is forgotten.
static void scenesInActivationOrder() {
  Lifecycle lifecycle;
  SceneId a = 0, b = 0, c = 0;

  onMain([&] {
    a = lifecycle.connect();
    b = lifecycle.connect();
  });

  CHECK(a != 0 && b != 0 && a != b);
  // Never activated: the most recently connected first.
  CHECK((lifecycle.scenes() == std::vector<SceneId>{b, a}));

  onMain([&] { lifecycle.report(a, SceneEvent::DidActivate); });
  CHECK((lifecycle.scenes() == std::vector<SceneId>{a, b}));

  onMain([&] {
    lifecycle.report(b, SceneEvent::WillEnterForeground);
    lifecycle.report(b, SceneEvent::DidActivate);
  });
  CHECK((lifecycle.scenes() == std::vector<SceneId>{b, a}));

  onMain([&] {
    lifecycle.report(b, SceneEvent::DidDisconnect);
    c = lifecycle.connect();
  });
  CHECK((lifecycle.scenes() == std::vector<SceneId>{c, a}));
  CHECK(c != b && c > b);

  // A scene it does not know, or no longer does, is ignored.
  onMain([&] {
    lifecycle.report(b, SceneEvent::DidActivate);
    lifecycle.report(9999999, SceneEvent::DidDisconnect);
  });
  CHECK((lifecycle.scenes() == std::vector<SceneId>{c, a}));
}

/// Each connected scene has a scope: disconnecting the scene disposes it,
/// ending the work tied to that scene.
static void sceneScopesEndWithTheirScene() {
  Lifecycle lifecycle;
  SceneId scene = 0;
  int cleanups = 0;

  onMain([&] { scene = lifecycle.connect(); });

  std::shared_ptr<Scope> scope = lifecycle.sceneScope(scene);
  CHECK(scope && scope->state() == Scope::State::Active);
  scope->onDispose([&] { cleanups++; });

  onMain([&] { lifecycle.report(scene, SceneEvent::DidDisconnect); });

  CHECK(cleanups == 1 && scope->state() == Scope::State::Disposed);
  CHECK(lifecycle.sceneScope(scene) == nullptr);
  CHECK(lifecycle.sceneScope(0) == nullptr);

  // Destroying the lifecycle ends the scenes it still knows.
  auto other = std::make_unique<Lifecycle>();
  onMain([&] { scene = other->connect(); });
  std::shared_ptr<Scope> last = other->sceneScope(scene);
  other.reset();
  CHECK(last->state() == Scope::State::Disposed);
}

/// The scene to present from: the most recently activated of those in the
/// foreground and active, else of those in the foreground; none while all
/// are in the background or not attached.
static void presentingSceneFollowsTheForeground() {
  std::map<SceneId, SceneState> states;
  auto stateOf = [&](SceneId s) { return states.count(s) ? states[s] : SceneState::Unattached; };

  CHECK(!presentingScene({}, stateOf).has_value());

  states = {{1, SceneState::Background}, {2, SceneState::Unattached}};
  CHECK(!presentingScene({1, 2}, stateOf).has_value());

  states = {{1, SceneState::ForegroundInactive}, {2, SceneState::ForegroundActive}, {3, SceneState::ForegroundActive}};
  CHECK(presentingScene({1, 2, 3}, stateOf) == SceneId(2));
  CHECK(presentingScene({3, 1, 2}, stateOf) == SceneId(3));

  states = {{1, SceneState::Background}, {2, SceneState::ForegroundInactive}, {3, SceneState::ForegroundInactive}};
  CHECK(presentingScene({1, 3, 2}, stateOf) == SceneId(3));
}

// --- subscriptions ------------------------------------------------------------

/// A listener hears its own event, on the thread the platform reports it
/// on, until its subscription closes; closing again is harmless.
static void subscriptionsHearTheirEvent() {
  Lifecycle lifecycle;
  std::atomic<int> active{0}, background{0}, onMainThreadCalls{0};

  auto sub = lifecycle.subscribe(AppEvent::DidBecomeActive, [&] {
    if (onMainThread()) onMainThreadCalls++;
    active++;
  });
  auto other = lifecycle.subscribe(AppEvent::DidEnterBackground, [&] { background++; });

  CHECK(sub->isOpen() && lifecycle.subscriptions() == 2);

  onMain([&] {
    lifecycle.report(AppEvent::DidBecomeActive);
    lifecycle.report(AppEvent::WillResignActive);
    lifecycle.report(AppEvent::DidBecomeActive);
  });
  CHECK(active == 2 && onMainThreadCalls == 2 && background == 0);

  CHECK(sub->close());
  CHECK(!sub->close());
  CHECK(lifecycle.subscriptions() == 1);

  onMain([&] {
    lifecycle.report(AppEvent::DidBecomeActive);
    lifecycle.report(AppEvent::DidEnterBackground);
  });
  CHECK(active == 2 && background == 1);

  // Dropping the handle does not end a subscription: its scope, or close(), does.
  std::weak_ptr<Resource> watch = other;
  other.reset();
  CHECK(!watch.expired() && lifecycle.subscriptions() == 1);

  onMain([&] { lifecycle.report(AppEvent::DidEnterBackground); });
  CHECK(background == 2);

  watch.lock()->close();
  CHECK(lifecycle.subscriptions() == 0 && watch.expired());
}

/// Scene listeners hear which scene. Connecting a scene announces nothing:
/// the platform reports WillConnect once it can name the scene (a scene it
/// found already connected, it never reports).
static void sceneListenersHearWhichScene() {
  Lifecycle lifecycle;
  std::vector<std::pair<SceneEvent, SceneId>> heard;

  for (SceneEvent e : {SceneEvent::WillConnect, SceneEvent::DidActivate, SceneEvent::DidDisconnect})
    lifecycle.subscribe(e, [&heard, e](SceneId s) { heard.emplace_back(e, s); });

  SceneId found = 0, connected = 0;
  onMain([&] {
    found = lifecycle.connect();
    connected = lifecycle.connect();
    lifecycle.report(connected, SceneEvent::WillConnect);
    lifecycle.report(connected, SceneEvent::DidActivate);
    lifecycle.report(connected, SceneEvent::WillEnterForeground);
    lifecycle.report(found, SceneEvent::DidDisconnect);
  });

  CHECK((heard == std::vector<std::pair<SceneEvent, SceneId>>{
                      {SceneEvent::WillConnect, connected},
                      {SceneEvent::DidActivate, connected},
                      {SceneEvent::DidDisconnect, found},
                  }));
}

/// A subscription belongs to a scope: disposing the scope ends it, and one
/// made under a scope that has ended never starts.
static void scopesEndSubscriptions() {
  Lifecycle lifecycle;
  auto scope = Scope::create(1);
  int heard = 0;

  auto sub = lifecycle.subscribe(AppEvent::WillEnterForeground, [&] { heard++; }, scope);

  onMain([&] { lifecycle.report(AppEvent::WillEnterForeground); });
  CHECK(heard == 1);

  scope->dispose();
  CHECK(sub->state() == Resource::State::Closed && lifecycle.subscriptions() == 0);

  auto late = lifecycle.subscribe(AppEvent::WillEnterForeground, [&] { heard++; }, scope);
  CHECK(late->state() == Resource::State::Closed && lifecycle.subscriptions() == 0);

  onMain([&] { lifecycle.report(AppEvent::WillEnterForeground); });
  CHECK(heard == 1);
}

/// While listeners run: one that throws is reported and the others still
/// run; one closed by an earlier listener does not run; one added does not
/// run until the next event.
static void listenersDuringAnEvent() {
  Lifecycle lifecycle;
  std::vector<std::string> order;
  std::shared_ptr<Resource> second, added;

  lifecycle.subscribe(AppEvent::DidReceiveMemoryWarning, [&] {
    order.push_back("first");
    second->close();
    if (!added) added = lifecycle.subscribe(AppEvent::DidReceiveMemoryWarning, [&] { order.push_back("added"); });
    throwError(makeError(String::fromLatin1("Error"), String::fromLatin1("listener failed")));
  });
  second = lifecycle.subscribe(AppEvent::DidReceiveMemoryWarning, [&] { order.push_back("second"); });
  lifecycle.subscribe(AppEvent::DidReceiveMemoryWarning, [&] { order.push_back("third"); });

  onMain([&] { lifecycle.report(AppEvent::DidReceiveMemoryWarning); });
  CHECK((order == std::vector<std::string>{"first", "third"}));

  order.clear();
  onMain([&] { lifecycle.report(AppEvent::DidReceiveMemoryWarning); });
  CHECK((order == std::vector<std::string>{"first", "third", "added"}));
}

/// A subscription outliving its lifecycle closes harmlessly.
static void subscriptionsOutliveTheirLifecycle() {
  auto lifecycle = std::make_unique<Lifecycle>();
  int heard = 0;

  auto sub = lifecycle->subscribe(AppEvent::WillTerminate, [&] { heard++; });
  lifecycle.reset();

  CHECK(sub->close());
  CHECK(heard == 0);
}

/// Subscribing and closing on other threads while the main thread reports:
/// nothing is left behind, and once every close has returned, no listener
/// runs again. (A close racing a report on another thread may let its
/// listener hear that event: closing never waits for the main thread.)
static void subscriptionRaces() {
  Lifecycle lifecycle;
  std::atomic<bool> stop{false};
  std::atomic<int> calls{0};

  std::thread reporter([&] {
    while (!stop) onMain([&] { lifecycle.report(AppEvent::DidBecomeActive); });
  });

  std::vector<std::thread> threads;
  for (int t = 0; t < 4; t++) {
    threads.emplace_back([&] {
      for (int i = 0; i < raceIterations(); i++) {
        auto sub = lifecycle.subscribe(AppEvent::DidBecomeActive, [&calls] { calls++; });
        std::this_thread::yield();
        sub->close();
      }
    });
  }

  for (auto& t : threads) t.join();
  stop = true;
  reporter.join();

  int before = calls;
  onMain([&] { lifecycle.report(AppEvent::DidBecomeActive); });

  CHECK(calls == before);
  CHECK(lifecycle.subscriptions() == 0);
}

// --- presentations --------------------------------------------------------------

/// What a test's platform showed and dismissed.
struct Shown {
  std::atomic<int> shown{0};
  std::atomic<int> dismissed{0};
  std::atomic<int> dismissedOnMain{0};

  /// Shows (counting it) and returns a dismissal that counts where it ran.
  std::function<void()> show() {
    shown++;
    return [this] {
      if (onMainThread()) dismissedOnMain++;
      dismissed++;
    };
  }
};

/// The operation's outcome as "<state>" or "<state> <error>".
template <class T>
static std::string outcomeOf(const std::shared_ptr<Operation<T>>& op) {
  std::string out;
  op->onSettled([&](const typename Operation<T>::Outcome& o) {
    static const char* names[] = {"pending", "succeeded", "failed", "cancelled"};
    out = names[static_cast<int>(o.state)];
    if (o.error) out += " " + describe(o.error);
    if (o.value) {
      if constexpr (std::is_same_v<T, double>) out += " " + std::to_string(static_cast<int>(*o.value));
    }
  });
  return out.empty() ? "pending" : out;
}

/// A connected scene, the lifecycle that knows it, and a scope for what is
/// presented there (an operation refers to its scope weakly: the last
/// reference to a scope disposes it).
struct Stage {
  Lifecycle lifecycle;
  SceneId scene = 0;
  std::shared_ptr<Scope> scope = Scope::create(1);

  Stage() {
    onMain([&] {
      scene = lifecycle.connect();
      lifecycle.report(scene, SceneEvent::DidActivate);
    });
  }

  template <class T>
  std::shared_ptr<Operation<T>> present(const std::shared_ptr<Scope>& scope, Opt<AbortSignal> signal,
                                        std::function<std::function<void()>(const std::shared_ptr<Operation<T>>&)> show,
                                        SceneId in = ~SceneId(0)) {
    std::shared_ptr<Operation<T>> op;
    onMain([&] { op = presentIn<T>(lifecycle, in == ~SceneId(0) ? scene : in, scope, signal, show); });
    return op;
  }
};

/// Presenting is done on the main thread: elsewhere is a caller bug.
static void presentingNeedsTheMainThread() {
  Stage stage;
  bool called = false;

  CHECK(thrown([&] {
          presentIn<double>(stage.lifecycle, stage.scene, Scope::create(1), {}, [&](const std::shared_ptr<Operation<double>>&) {
            called = true;
            return std::function<void()>();
          });
        }).rfind("logic_error", 0) == 0);
  CHECK(!called);
}

/// A result settles the presentation and dismisses what it showed, once,
/// on the main thread, whichever thread settled it.
static void aResultDismisses() {
  Stage stage;
  Shown ui;
  std::shared_ptr<Operation<double>> kept;

  auto op = stage.present<double>(stage.scope, {}, [&](const std::shared_ptr<Operation<double>>& op) {
    kept = op;
    return ui.show();
  });

  CHECK(op->state() == OperationState::Pending && ui.shown == 1 && ui.dismissed == 0);

  std::thread([&] { CHECK(kept->succeed(42)); }).join();
  CHECK(mainCaughtUp());

  CHECK(outcomeOf(op) == "succeeded 42");
  CHECK(ui.dismissed == 1 && ui.dismissedOnMain == 1);

  // Later outcomes are dropped; nothing is dismissed again.
  CHECK(!op->fail(makeError(String::fromLatin1("Error"), String::fromLatin1("late"))));
  CHECK(mainCaughtUp());
  CHECK(ui.dismissed == 1 && op->lateOutcomes() == 1);

  // Nothing is left tied to the scene.
  CHECK(stage.lifecycle.sceneScope(stage.scene)->registrations() == 0);
}

/// Aborting the signal cancels it with the signal's reason and dismisses.
static void theSignalCancels() {
  Stage stage;
  Shown ui;
  auto controller = std::make_shared<AbortControllerObject>();

  auto op = stage.present<double>(stage.scope, controller->signal, [&](const auto&) { return ui.show(); });
  CHECK(op->state() == OperationState::Pending);

  controller->abort(makeError(String::fromLatin1("AbortError"), String::fromLatin1("changed my mind")));
  CHECK(within(2000, [&] { return op->state() != OperationState::Pending; }));
  CHECK(mainCaughtUp());

  CHECK(outcomeOf(op) == "cancelled AbortError: changed my mind");
  CHECK(ui.dismissed == 1 && ui.dismissedOnMain == 1);
}

/// Already aborted, or under a scope that has ended: cancelled before
/// anything is shown.
static void cancelledBeforeShowing() {
  Stage stage;
  Shown ui;

  auto controller = std::make_shared<AbortControllerObject>();
  controller->abort(Opt<Error>());
  CHECK(moduleCaughtUp());

  auto aborted = stage.present<double>(stage.scope, controller->signal, [&](const auto&) { return ui.show(); });
  CHECK(outcomeOf(aborted) == "cancelled AbortError: signal is aborted without reason");

  auto ended = Scope::create(1);
  ended->dispose();
  auto late = stage.present<double>(ended, {}, [&](const auto&) { return ui.show(); });
  CHECK(late->state() == OperationState::Cancelled);

  CHECK(ui.shown == 0 && ui.dismissed == 0);
}

/// Disposing the scope it belongs to cancels it and dismisses.
static void theScopeCancels() {
  Stage stage;
  Shown ui;
  auto scope = Scope::create(1);

  auto op = stage.present<double>(scope, {}, [&](const auto&) { return ui.show(); });

  std::thread([&] { scope->dispose(); }).join();
  CHECK(mainCaughtUp());

  CHECK(outcomeOf(op).rfind("cancelled AbortError", 0) == 0);
  CHECK(ui.dismissed == 1 && ui.dismissedOnMain == 1);
}

/// Its scene disconnecting cancels it: what was shown went with the scene.
static void theSceneGoing() {
  Stage stage;
  Shown ui;

  auto op = stage.present<double>(stage.scope, {}, [&](const auto&) { return ui.show(); });

  onMain([&] { stage.lifecycle.report(stage.scene, SceneEvent::DidDisconnect); });
  CHECK(mainCaughtUp());

  CHECK(outcomeOf(op) == "cancelled AbortError: The scene disconnected");
  CHECK(ui.dismissed == 1);
}

/// With no scene to present from, it fails without showing anything.
static void noScene() {
  Stage stage;
  Shown ui;

  auto none = stage.present<double>(stage.scope, {}, [&](const auto&) { return ui.show(); }, 0);
  CHECK(outcomeOf(none) == "failed InvalidStateError: No scene is in the foreground to present from");

  onMain([&] { stage.lifecycle.report(stage.scene, SceneEvent::DidDisconnect); });
  auto gone = stage.present<double>(stage.scope, {}, [&](const auto&) { return ui.show(); });
  CHECK(outcomeOf(gone) == "failed InvalidStateError: No scene is in the foreground to present from");

  CHECK(ui.shown == 0);
}

/// Showing may throw (the platform refused), failing it with that error,
/// or settle it at once: then what it showed is dismissed right away.
static void showingThrowsOrSettles() {
  Stage stage;
  Shown ui;

  auto refused = stage.present<double>(stage.scope, {}, [&](const auto&) -> std::function<void()> {
    throwError(makeError(String::fromLatin1("InvalidStateError"), String::fromLatin1("already presented")));
  });
  CHECK(outcomeOf(refused) == "failed InvalidStateError: already presented");
  CHECK(stage.lifecycle.sceneScope(stage.scene)->registrations() == 0);

  auto atOnce = stage.present<double>(stage.scope, {}, [&](const std::shared_ptr<Operation<double>>& op) {
    auto dismiss = ui.show();
    op->succeed(7);
    return dismiss;
  });
  CHECK(mainCaughtUp());
  CHECK(outcomeOf(atOnce) == "succeeded 7");
  CHECK(ui.dismissed == 1);
  CHECK(stage.lifecycle.sceneScope(stage.scene)->registrations() == 0);

  // A presentation with no value.
  std::shared_ptr<Operation<void>> done;
  auto nothing = stage.present<void>(stage.scope, {}, [&](const std::shared_ptr<Operation<void>>& op) {
    done = op;
    return ui.show();
  });
  CHECK(done->succeed());
  CHECK(mainCaughtUp());
  CHECK(outcomeOf(nothing) == "succeeded" && ui.dismissed == 2);
}

/// A result, the signal, the scope and the scene race from several
/// threads: one outcome wins, and what was shown is dismissed once.
static void presentationRaces() {
  int bad = 0;

  for (int i = 0; i < raceIterations(); i++) {
    Stage stage;
    Shown ui;
    auto scope = Scope::create(1);
    auto controller = std::make_shared<AbortControllerObject>();
    std::shared_ptr<Operation<double>> kept;

    auto op = stage.present<double>(scope, controller->signal, [&](const std::shared_ptr<Operation<double>>& op) {
      kept = op;
      return ui.show();
    });

    std::atomic<bool> go{false};
    std::atomic<int> won{0};
    std::vector<std::thread> threads;
    threads.emplace_back([&] {
      while (!go) std::this_thread::yield();
      if (kept->succeed(1)) won++;
    });
    threads.emplace_back([&] {
      while (!go) std::this_thread::yield();
      controller->abort(Opt<Error>());
    });
    threads.emplace_back([&] {
      while (!go) std::this_thread::yield();
      scope->dispose();
    });
    threads.emplace_back([&] {
      while (!go) std::this_thread::yield();
      onMain([&] { stage.lifecycle.report(stage.scene, SceneEvent::DidDisconnect); });
    });

    go = true;
    for (auto& t : threads) t.join();
    moduleCaughtUp();
    mainCaughtUp();

    if (op->state() == OperationState::Pending || ui.dismissed != 1 || won > 1) bad++;
  }

  CHECK(bad == 0);
}

int main() {
  reportsComeFromTheMainThread();
  scenesInActivationOrder();
  sceneScopesEndWithTheirScene();
  presentingSceneFollowsTheForeground();

  subscriptionsHearTheirEvent();
  sceneListenersHearWhichScene();
  scopesEndSubscriptions();
  listenersDuringAnEvent();
  subscriptionsOutliveTheirLifecycle();
  subscriptionRaces();

  presentingNeedsTheMainThread();
  aResultDismisses();
  theSignalCancels();
  cancelledBeforeShowing();
  theScopeCancels();
  theSceneGoing();
  noScene();
  showingThrowsOrSettles();
  presentationRaces();

  std::printf("lifecycle: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
