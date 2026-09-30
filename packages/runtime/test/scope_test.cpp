// Unit tests for lifetime scopes and one-shot operations (lucent/scope.h).
// Built and run by `packages/runtime/test/run.sh`, also under ASan/UBSan
// and TSan: the race tests settle, cancel and dispose from several threads.
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include "lucent/jserror.h"
#include "lucent/scope.h"

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

static Error E(const char* name, const char* message = "") {
  return makeError(String::fromUtf8(name), String::fromUtf8(message));
}

static std::string nameOf(const Error& e) { return e ? e->name.toUtf8() : ""; }

static std::string messageOf(const Error& e) { return e ? e->message.toUtf8() : ""; }

static Error errorOf(std::exception_ptr e) { return e ? currentError(e) : nullptr; }

/// A cleanup that throws a Lucent error named `name`.
static std::function<void()> throwing(const char* name, std::vector<std::string>* log = nullptr) {
  return [name, log] {
    if (log) log->push_back(name);

    throwError(E(name));
  };
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

static bool contains(const std::string& text, const char* part) { return text.find(part) != std::string::npos; }

/// Runs each function on its own thread, released together so they overlap.
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

static int raceIterations() {
  const char* n = std::getenv("LUCENT_RACE_ITERATIONS");
  return n ? std::atoi(n) : 500;
}

// --- identities ---------------------------------------------------------

static void identities() {
  auto a = Scope::create(7);
  auto b = Scope::create(7);

  CHECK(a->id() != 0 && b->id() > a->id());
  CHECK(a->runtime() == 7);
  CHECK(a->generation() != 0);
  CHECK(a->state() == Scope::State::Active);

  auto op = Operation<double>::start(a);
  OperationToken t = op->token();

  CHECK(t.runtime == 7 && t.scope == a->id() && t.generation == a->generation());
  CHECK(t.operation != 0);
  CHECK(op->state() == OperationState::Pending);

  // A headless scope has no JS runtime.
  CHECK(Scope::create(0)->runtime() == 0);

  a->dispose();
  b->dispose();
}

// --- Scope ----------------------------------------------------------------

static void cleanupsRunInReverseOnce() {
  auto scope = Scope::create(1);
  std::vector<std::string> log;
  Scope::State during = Scope::State::Active;

  scope->onDispose([&] { log.push_back("first"); });
  scope->onDispose([&] {
    log.push_back("second");
    during = scope->state();
  });
  scope->onDispose([&] { log.push_back("third"); });

  Generation before = scope->generation();
  CHECK(scope->dispose() == nullptr);

  CHECK((log == std::vector<std::string>{"third", "second", "first"}));
  CHECK(during == Scope::State::Disposing);
  CHECK(scope->state() == Scope::State::Disposed);
  CHECK(scope->generation() == before + 1);

  // Idempotent: nothing runs again and the generation stays.
  CHECK(scope->dispose() == nullptr);
  CHECK(log.size() == 3);
  CHECK(scope->generation() == before + 1);
}

static void registrationAfterDisposeRunsNow() {
  auto scope = Scope::create(1);
  int ran = 0;
  Scope::CleanupId late = 1;

  scope->onDispose([&] {
    // Registered while disposing: runs now, not after this cleanup.
    late = scope->onDispose([&] { ran++; });
    CHECK(ran == 1);
  });
  scope->dispose();

  CHECK(late == 0 && ran == 1);

  CHECK(scope->onDispose([&] { ran++; }) == 0);
  CHECK(ran == 2);

  // It runs on the caller, so its error reaches the caller.
  bool threw = false;
  try {
    scope->onDispose(throwing("TypeError"));
  } catch (const Exception& e) {
    threw = nameOf(e.error()) == "TypeError";
  }
  CHECK(threw);

  // An empty cleanup is a caller bug.
  bool rejected = false;
  try {
    Scope::create(1)->onDispose({});
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  CHECK(rejected);
}

static void removeCleanups() {
  auto scope = Scope::create(1);
  int a = 0, b = 0;

  Scope::CleanupId idA = scope->onDispose([&] { a++; });
  Scope::CleanupId idB = scope->onDispose([&] { b++; });

  CHECK(idA != 0 && idB != 0 && idA != idB);
  CHECK(scope->remove(idA));
  CHECK(!scope->remove(idA));
  CHECK(!scope->remove(0));

  scope->dispose();

  CHECK(a == 0 && b == 1);
  CHECK(!scope->remove(idB));
}

static void cleanupErrorsAggregateLikeUsing() {
  auto scope = Scope::create(1);
  std::vector<std::string> log;

  scope->onDispose(throwing("First", &log));
  scope->onDispose([&] { log.push_back("ok"); });
  scope->onDispose(throwing("Second", &log));
  scope->onDispose(throwing("Third", &log));

  Error e = errorOf(scope->dispose());

  // Every cleanup ran, in reverse.
  CHECK((log == std::vector<std::string>{"Third", "Second", "ok", "First"}));

  // SuppressedError(First, SuppressedError(Second, Third)): the last error,
  // with the one pending before it as `suppressed`.
  auto outer = std::dynamic_pointer_cast<SuppressedErrorObject>(e);
  CHECK(outer != nullptr);
  if (!outer) return;

  CHECK(nameOf(outer->error) == "First");

  auto inner = std::dynamic_pointer_cast<SuppressedErrorObject>(outer->suppressed);
  CHECK(inner != nullptr);
  if (!inner) return;

  CHECK(nameOf(inner->error) == "Second");
  CHECK(nameOf(inner->suppressed) == "Third");

  // One error comes back as itself.
  auto single = Scope::create(1);
  single->onDispose(throwing("Only"));
  CHECK(nameOf(errorOf(single->dispose())) == "Only");
}

static void reentrantDisposeReturns() {
  auto scope = Scope::create(1);
  int ran = 0;
  std::exception_ptr inner = std::make_exception_ptr(1);

  scope->onDispose([&] { ran++; });
  scope->onDispose([&] {
    inner = scope->dispose();
    ran++;
  });

  CHECK(scope->dispose() == nullptr);
  CHECK(inner == nullptr);
  CHECK(ran == 2);
}

static void childScopes() {
  auto parent = Scope::create(3);
  std::vector<std::string> log;

  parent->onDispose([&] { log.push_back("parent"); });

  auto older = Scope::create(3, parent);
  auto newer = Scope::create(3, parent);
  auto grandchild = Scope::create(3, older);

  older->onDispose([&] { log.push_back("older"); });
  newer->onDispose([&] { log.push_back("newer"); });
  grandchild->onDispose([&] { log.push_back("grandchild"); });

  parent->dispose();

  // Children first, most recently created first, depth first.
  CHECK((log == std::vector<std::string>{"newer", "grandchild", "older", "parent"}));
  CHECK(older->state() == Scope::State::Disposed && grandchild->state() == Scope::State::Disposed);

  // A child of an inactive scope is born disposed.
  auto orphan = Scope::create(3, parent);
  int ran = 0;

  CHECK(orphan->state() == Scope::State::Disposed);
  CHECK(orphan->onDispose([&] { ran++; }) == 0 && ran == 1);

  // Child errors reach the parent's dispose.
  auto p2 = Scope::create(3);
  auto c2 = Scope::create(3, p2);
  c2->onDispose(throwing("ChildError"));
  CHECK(nameOf(errorOf(p2->dispose())) == "ChildError");
}

/// Whether `f` throws std::invalid_argument.
template <class F>
static bool invalid(F f) {
  try {
    f();
  } catch (const std::invalid_argument&) {
    return true;
  }

  return false;
}

/// What runs under a runtime's scope belongs to that runtime: a child names
/// its parent's runtime, unless the parent belongs to none.
static void childrenBelongToTheirParentsRuntime() {
  auto process = Scope::create(0);
  auto host = Scope::create(5, process);
  auto work = Scope::create(5, host);

  CHECK(host->runtime() == 5 && work->runtime() == 5);

  CHECK(invalid([&] { Scope::create(6, host); }));
  CHECK(invalid([&] { Scope::create(0, work); }));

  // A refused child leaves nothing behind: the parent disposes as before.
  int ran = 0;
  host->onDispose([&] { ran++; });

  CHECK(host->dispose() == nullptr);
  CHECK(ran == 1 && work->state() == Scope::State::Disposed);
}

/// What a scope holds, for debug ownership reports: live children, pending
/// operations and cleanups not yet run. Each leaves the count when it ends.
static void registrationsCountWhatIsHeld() {
  auto scope = Scope::create(1);

  CHECK(scope->registrations() == 0);

  Scope::CleanupId cleanup = scope->onDispose([] {});
  auto child = Scope::create(1, scope);
  auto op = Operation<double>::start(scope);

  CHECK(scope->registrations() == 3);

  scope->remove(cleanup);
  child->dispose();
  op->succeed(1);

  CHECK(scope->registrations() == 0);

  scope->onDispose([] {});
  scope->dispose();

  CHECK(scope->registrations() == 0);
}

static void parentOwnsLiveChildren() {
  auto parent = Scope::create(1);
  std::weak_ptr<Scope> weakChild;
  int ran = 0;

  {
    auto child = Scope::create(1, parent);
    child->onDispose([&] { ran++; });
    weakChild = child;
  }

  // The parent keeps a live child alive.
  CHECK(!weakChild.expired() && ran == 0);

  // A child disposed on its own leaves the parent.
  weakChild.lock()->dispose();
  CHECK(ran == 1);
  CHECK(weakChild.expired());

  // The child does not keep its parent alive.
  auto child = Scope::create(1, parent);
  std::weak_ptr<Scope> weakParent = parent;
  parent.reset();

  CHECK(weakParent.expired());
  CHECK(child->state() == Scope::State::Disposed);
}

static void destructionDisposes() {
  std::vector<std::string> log;
  auto child = std::shared_ptr<Scope>();
  StderrCapture capture;

  {
    auto scope = Scope::create(1);
    child = Scope::create(1, scope);
    scope->onDispose([&] { log.push_back("a"); });
    scope->onDispose(throwing("DestructorError", &log));
    child->onDispose([&] { log.push_back("child"); });
  }

  std::string err = capture.finish();

  CHECK((log == std::vector<std::string>{"child", "DestructorError", "a"}));
  CHECK(child->state() == Scope::State::Disposed);

  // Destructors cannot throw: the error goes to reportUncaught.
  CHECK(contains(err, "uncaught exception in scope") && contains(err, "DestructorError"));
}

static void tokensValidateAllFields() {
  auto scope = Scope::create(4);
  auto other = Scope::create(4);
  auto op = Operation<double>::start(scope);
  OperationToken t = op->token();

  CHECK(scope->validates(t));
  CHECK(!other->validates(t));

  OperationToken wrongRuntime = t;
  wrongRuntime.runtime = 5;
  CHECK(!scope->validates(wrongRuntime));

  OperationToken wrongScope = t;
  wrongScope.scope = other->id();
  CHECK(!scope->validates(wrongScope));

  OperationToken wrongGeneration = t;
  wrongGeneration.generation++;
  CHECK(!scope->validates(wrongGeneration));

  OperationToken wrongOperation = t;
  wrongOperation.operation = Operation<double>::start(other)->token().operation;
  CHECK(!scope->validates(wrongOperation));

  CHECK(!scope->validates(OperationToken{}));

  // Only while the operation is pending.
  op->succeed(1);
  CHECK(!scope->validates(t));

  auto pending = Operation<double>::start(scope);
  OperationToken t2 = pending->token();
  CHECK(scope->validates(t2));

  scope->dispose();
  CHECK(!scope->validates(t2));

  other->dispose();
}

// --- Operation: rule 1, one transition --------------------------------------

static void oneTransition() {
  auto scope = Scope::create(1);
  auto op = Operation<double>::start(scope);

  CHECK(op->succeed(1));
  CHECK(!op->succeed(2));
  CHECK(!op->fail(E("Error")));
  CHECK(!op->cancel(E("AbortError")));

  CHECK(op->state() == OperationState::Succeeded);

  double seen = 0;
  op->onSettled([&](const Operation<double>::Outcome& o) { seen = *o.value; });
  CHECK(seen == 1);

  auto failed = Operation<double>::start(scope);
  CHECK(failed->fail(E("RangeError", "no")));
  CHECK(!failed->cancel(E("AbortError")));
  CHECK(failed->state() == OperationState::Failed);

  auto cancelled = Operation<double>::start(scope);
  CHECK(cancelled->cancel(E("AbortError", "stop")));
  CHECK(!cancelled->succeed(3));
  CHECK(cancelled->state() == OperationState::Cancelled);

  scope->dispose();
}

static void lateOutcomesAreReleased() {
  using Payload = std::shared_ptr<int>;
  auto scope = Scope::create(1);

  // With a release hook, a losing payload goes to it, not to listeners.
  auto op = Operation<Payload>::start(scope);
  std::vector<int> released;
  int delivered = 0;

  op->onLateOutcome([&](Payload&& p) { released.push_back(*p); });
  op->onSettled([&](const Operation<Payload>::Outcome&) { delivered++; });

  CHECK(op->cancel(E("AbortError")));
  CHECK(!op->succeed(std::make_shared<int>(7)));

  CHECK((released == std::vector<int>{7}));
  CHECK(delivered == 1);

  // Without one, it is destroyed.
  auto bare = Operation<Payload>::start(scope);
  auto payload = std::make_shared<int>(8);
  std::weak_ptr<int> watch = payload;

  CHECK(bare->fail(E("Error")));
  CHECK(!bare->succeed(std::move(payload)));
  CHECK(watch.expired());

  // The winner's payload is delivered and kept, not released.
  auto won = Operation<Payload>::start(scope);
  int lateCalls = 0;

  won->onLateOutcome([&](Payload&&) { lateCalls++; });
  CHECK(won->succeed(std::make_shared<int>(9)));

  int seen = 0;
  won->onSettled([&](const Operation<Payload>::Outcome& o) { seen = **o.value; });

  CHECK(seen == 9 && lateCalls == 0);

  scope->dispose();
}

// --- rule 2: cleanup ------------------------------------------------------

static void cleanupRunsOnceAfterSettlement() {
  auto scope = Scope::create(1);

  // Registered before settlement: runs at settlement, after the listeners.
  auto op = Operation<double>::start(scope);
  std::vector<std::string> log;

  op->setCleanup([&] { log.push_back("cleanup"); });
  op->onSettled([&](const Operation<double>::Outcome&) { log.push_back("listener"); });

  CHECK(log.empty());

  op->succeed(1);
  op->succeed(2);
  op->cancel(E("AbortError"));

  CHECK((log == std::vector<std::string>{"listener", "cleanup"}));

  // Removing it after it ran is a no-op.
  op->setCleanup({});
  CHECK(log.size() == 2);

  // Registered after settlement (synchronous completion): runs now.
  auto sync = Operation<double>::start(scope);
  int ran = 0;

  sync->succeed(1);
  sync->setCleanup([&] { ran++; });
  CHECK(ran == 1);

  // Removed before settlement: never runs.
  auto removed = Operation<double>::start(scope);
  int removedRan = 0;

  removed->setCleanup([&] { removedRan++; });
  removed->setCleanup({});
  removed->succeed(1);
  CHECK(removedRan == 0);

  // A second cleanup while one is pending is a caller bug.
  auto twice = Operation<double>::start(scope);
  bool rejected = false;

  twice->setCleanup([] {});
  try {
    twice->setCleanup([] {});
  } catch (const std::logic_error&) {
    rejected = true;
  }
  CHECK(rejected);

  scope->dispose();
}

// --- rule 3: listeners ----------------------------------------------------

static void listenersRunOnce() {
  auto scope = Scope::create(1);
  auto op = Operation<double>::start(scope);
  std::vector<std::string> log;

  op->onSettled([&](const Operation<double>::Outcome& o) {
    log.push_back("a");
    CHECK(o.state == OperationState::Failed);
    CHECK(!o.value.has_value());
    CHECK(nameOf(o.error) == "RangeError" && messageOf(o.error) == "bad");
  });
  op->onSettled([&](const Operation<double>::Outcome&) { log.push_back("b"); });

  op->fail(E("RangeError", "bad"));
  op->fail(E("RangeError", "again"));

  CHECK((log == std::vector<std::string>{"a", "b"}));

  // After settlement: runs immediately, with the same outcome.
  op->onSettled([&](const Operation<double>::Outcome& o) {
    log.push_back("late");
    CHECK(messageOf(o.error) == "bad");
  });
  CHECK(log.size() == 3 && log.back() == "late");

  // Success delivers the value.
  auto ok = Operation<double>::start(scope);
  double value = 0;

  ok->onSettled([&](const Operation<double>::Outcome& o) {
    CHECK(o.state == OperationState::Succeeded && o.error == nullptr);
    value = *o.value;
  });
  ok->succeed(4.5);
  CHECK(value == 4.5);

  scope->dispose();
}

static void callbackErrorsAreReported() {
  auto scope = Scope::create(1);
  auto op = Operation<double>::start(scope);
  std::vector<std::string> log;
  StderrCapture capture;

  op->onSettled([&](const Operation<double>::Outcome&) { throwError(E("ListenerError")); });
  op->onSettled([&](const Operation<double>::Outcome&) { log.push_back("second listener"); });
  op->setCleanup(throwing("CleanupError", &log));

  // Settlement still wins, and everything still runs.
  bool won = op->succeed(1);

  auto sync = Operation<double>::start(scope);
  sync->succeed(1);
  sync->setCleanup(throwing("LateCleanupError"));

  std::string err = capture.finish();

  CHECK(won);
  CHECK((log == std::vector<std::string>{"second listener", "CleanupError"}));
  CHECK(contains(err, "uncaught exception in operation"));
  CHECK(contains(err, "ListenerError") && contains(err, "CleanupError") && contains(err, "LateCleanupError"));

  scope->dispose();
}

static void voidOperations() {
  auto scope = Scope::create(1);
  auto op = Operation<void>::start(scope);
  int settled = 0;

  op->onSettled([&](const Operation<void>::Outcome& o) {
    CHECK(o.state == OperationState::Succeeded);
    settled++;
  });

  CHECK(op->succeed());
  CHECK(!op->succeed());
  CHECK(settled == 1 && op->lateOutcomes() == 1);

  scope->dispose();
}

// --- rules 4 and 5: registration -----------------------------------------------

static void registration() {
  auto scope = Scope::create(1);

  // Aborted before registration: created Cancelled, registration not called.
  bool called = false;
  auto aborted = Operation<double>::start(
      scope,
      [&](const std::shared_ptr<Operation<double>>&) {
        called = true;
        return std::function<void()>();
      },
      E("AbortError", "already"));

  CHECK(!called);
  CHECK(aborted->state() == OperationState::Cancelled);
  CHECK(!scope->validates(aborted->token()));

  Error reason;
  aborted->onSettled([&](const Operation<double>::Outcome& o) { reason = o.error; });
  CHECK(messageOf(reason) == "already");

  // Registration throws: Failed with that error.
  auto thrown = Operation<double>::start(scope, [](const std::shared_ptr<Operation<double>>&) -> std::function<void()> {
    throwError(E("TypeError", "cannot register"));
  });

  CHECK(thrown->state() == OperationState::Failed);

  Error failure;
  thrown->onSettled([&](const Operation<double>::Outcome& o) { failure = o.error; });
  CHECK(nameOf(failure) == "TypeError" && messageOf(failure) == "cannot register");

  // Completes during registration: the returned cleanup runs as it returns.
  std::vector<std::string> log;
  auto sync = Operation<double>::start(scope, [&](const std::shared_ptr<Operation<double>>& op) {
    op->onSettled([&](const Operation<double>::Outcome&) { log.push_back("settled"); });
    op->succeed(5);
    log.push_back("returning");
    return std::function<void()>([&] { log.push_back("cleanup"); });
  });

  CHECK((log == std::vector<std::string>{"settled", "returning", "cleanup"}));
  CHECK(sync->state() == OperationState::Succeeded);

  // Asynchronous completion: the cleanup waits for settlement.
  int cleaned = 0;
  auto async = Operation<double>::start(scope, [&](const std::shared_ptr<Operation<double>>&) {
    return std::function<void()>([&] { cleaned++; });
  });

  CHECK(async->state() == OperationState::Pending && cleaned == 0);

  async->succeed(1);
  CHECK(cleaned == 1);

  // Under an inactive scope: Cancelled, registration not called.
  scope->dispose();
  called = false;

  auto afterDispose = Operation<double>::start(scope, [&](const std::shared_ptr<Operation<double>>&) {
    called = true;
    return std::function<void()>();
  });

  CHECK(!called && afterDispose->state() == OperationState::Cancelled);
}

// --- rule 6: scope disposal cancels operations --------------------------------

static void disposalCancelsOperations() {
  auto scope = Scope::create(1);
  std::vector<std::string> log;

  scope->onDispose([&] { log.push_back("scope cleanup"); });

  auto first = Operation<double>::start(scope);
  auto second = Operation<double>::start(scope);
  auto done = Operation<double>::start(scope);

  first->onSettled([&](const Operation<double>::Outcome& o) {
    log.push_back("first " + nameOf(o.error));
    CHECK(o.state == OperationState::Cancelled);
  });
  first->setCleanup([&] { log.push_back("first cleanup"); });

  second->onSettled([&](const Operation<double>::Outcome&) { log.push_back("second cancelled"); });
  second->setCleanup([&] { log.push_back("second cleanup"); });

  done->succeed(1);
  done->onSettled([&](const Operation<double>::Outcome& o) { CHECK(o.state == OperationState::Succeeded); });

  OperationToken t1 = first->token();
  OperationToken t2 = second->token();

  CHECK(scope->validates(t1) && scope->validates(t2));

  scope->dispose();

  // Every pending operation is cancelled (most recent first) before any
  // operation cleanup runs, and those run before the scope's own cleanups.
  CHECK((log == std::vector<std::string>{"second cancelled", "first AbortError", "second cleanup", "first cleanup",
                                         "scope cleanup"}));
  CHECK(first->state() == OperationState::Cancelled && second->state() == OperationState::Cancelled);
  CHECK(done->state() == OperationState::Succeeded);
  CHECK(!scope->validates(t1) && !scope->validates(t2));

  // Their callbacks' errors join the scope's.
  auto s2 = Scope::create(1);
  auto op = Operation<double>::start(s2);

  op->onSettled([](const Operation<double>::Outcome&) { throwError(E("ListenerError")); });
  op->setCleanup(throwing("OperationCleanupError"));

  auto e = std::dynamic_pointer_cast<SuppressedErrorObject>(errorOf(s2->dispose()));
  CHECK(e != nullptr);
  if (e) CHECK(nameOf(e->error) == "OperationCleanupError" && nameOf(e->suppressed) == "ListenerError");

  // A late native callback after disposal reaches the release hook.
  auto s3 = Scope::create(1);
  auto res = Operation<std::shared_ptr<int>>::start(s3);
  int released = 0;

  res->onLateOutcome([&](std::shared_ptr<int>&&) { released++; });
  s3->dispose();

  CHECK(!res->succeed(std::make_shared<int>(1)));
  CHECK(released == 1);
}

// --- rule 7: repeated callbacks ------------------------------------------------

static void repeatedCallbacksAreCounted() {
  auto scope = Scope::create(1);
  auto op = Operation<double>::start(scope);
  int delivered = 0;

  op->onSettled([&](const Operation<double>::Outcome&) { delivered++; });

  CHECK(op->lateOutcomes() == 0);

  op->succeed(1);
  op->succeed(2);
  op->succeed(3);
  op->fail(E("Error"));

  CHECK(delivered == 1);
  CHECK(op->lateOutcomes() == 3);

  scope->dispose();
}

// --- rule 8: identities are never reused -----------------------------------------

static void idsAreNeverReused() {
  auto scope = Scope::create(1);
  std::set<OperationId> ids;
  OperationId last = 0;
  bool increasing = true;

  // Freed operations make their memory available again; never their ids.
  for (int i = 0; i < 1000; i++) {
    auto op = Operation<double>::start(scope);
    OperationId id = op->token().operation;

    increasing = increasing && id > last;
    last = id;
    ids.insert(id);
    op->succeed(i);
  }

  CHECK(increasing && ids.size() == 1000);

  std::set<ScopeId> scopes;
  for (int i = 0; i < 1000; i++) scopes.insert(Scope::create(1)->id());
  CHECK(scopes.size() == 1000);

  // After disposal, a new operation has a new id and the new generation.
  auto before = Operation<double>::start(scope);
  OperationToken old = before->token();

  scope->dispose();

  auto after = Operation<double>::start(scope);
  OperationToken fresh = after->token();

  CHECK(fresh.operation > old.operation);
  CHECK(fresh.generation == scope->generation() && fresh.generation != old.generation);
  CHECK(fresh.scope == old.scope && fresh.runtime == old.runtime);
  CHECK(!scope->validates(old) && !scope->validates(fresh));
}

// --- reentrancy ---------------------------------------------------------------

/// Runs `f` when destroyed.
struct OnDestroy {
  std::function<void()> f;

  ~OnDestroy() {
    if (f) f();
  }
};

/// Dropping a callback destroys what it captured, which may call back into
/// the same scope or operation: never while their lock is held.
static void droppedCallbacksMayReenter() {
  auto scope = Scope::create(1);
  auto op = Operation<std::shared_ptr<int>>::start(scope);
  int reentered = 0;

  auto intoScope = std::make_shared<OnDestroy>();
  intoScope->f = [&] { reentered += !scope->validates(OperationToken{}); };
  Scope::CleanupId id = scope->onDispose([intoScope] {});
  intoScope.reset();

  CHECK(scope->remove(id));
  CHECK(reentered == 1);

  auto intoCleanup = std::make_shared<OnDestroy>();
  intoCleanup->f = [&] {
    op->onSettled([](const Operation<std::shared_ptr<int>>::Outcome&) {});
    reentered++;
  };
  op->setCleanup([intoCleanup] {});
  intoCleanup.reset();

  op->setCleanup({});
  CHECK(reentered == 2);

  auto intoHook = std::make_shared<OnDestroy>();
  intoHook->f = [&] {
    op->onSettled([](const Operation<std::shared_ptr<int>>::Outcome&) {});
    reentered++;
  };
  op->onLateOutcome([intoHook](std::shared_ptr<int>&&) {});
  intoHook.reset();

  op->onLateOutcome([](std::shared_ptr<int>&&) {});
  CHECK(reentered == 3);

  scope->dispose();
}

// --- races ---------------------------------------------------------------

/// succeed, fail, cancel and the scope's dispose, from four threads: one
/// outcome, delivered once; one cleanup; the losing payload released.
static void settleCancelDisposeRace() {
  using Payload = std::shared_ptr<int>;
  int n = raceIterations();
  int bad = 0;

  for (int i = 0; i < n; i++) {
    auto scope = Scope::create(1);
    auto op = Operation<Payload>::start(scope);
    OperationToken token = op->token();

    std::atomic<int> listeners{0}, cleanups{0}, scopeCleanups{0}, released{0};
    std::atomic<bool> succeeded{false}, failed{false}, cancelled{false};

    op->onLateOutcome([&](Payload&&) { released++; });
    op->onSettled([&](const Operation<Payload>::Outcome&) { listeners++; });
    op->setCleanup([&] { cleanups++; });
    scope->onDispose([&] { scopeCleanups++; });

    race([&] { succeeded = op->succeed(std::make_shared<int>(i)); },
         [&] { failed = op->fail(E("Error", "failed")); },
         [&] { cancelled = op->cancel(E("AbortError", "by caller")); },
         [&] { scope->dispose(); });

    int winners = succeeded + failed + cancelled;
    bool disposeWon = false;
    std::string winner;

    op->onSettled([&](const Operation<Payload>::Outcome& o) {
      disposeWon = o.state == OperationState::Cancelled && messageOf(o.error) != "by caller";
      winner = o.state == OperationState::Succeeded ? "succeed" : messageOf(o.error);
    });
    winners += disposeWon;

    bool ok = winners == 1 && listeners == 1 && cleanups == 1 && scopeCleanups == 1;
    ok = ok && released == (succeeded ? 0 : 1);
    // The three callers' losing calls; disposal only cancels what is still
    // pending, and is not a callback.
    ok = ok && op->lateOutcomes() == (disposeWon ? 3u : 2u);
    ok = ok && !scope->validates(token);

    if (!ok) {
      bad++;
      std::fprintf(stderr, "race %d: winners=%d listeners=%d cleanups=%d released=%d late=%llu winner=%s\n", i, winners,
                   listeners.load(), cleanups.load(), released.load(),
                   static_cast<unsigned long long>(op->lateOutcomes()), winner.c_str());
    }
  }

  CHECK(bad == 0);
}

/// The registration returns its cleanup while another thread settles, and
/// a listener is added while it settles: each runs exactly once.
static void cleanupAndListenerRegistrationRace() {
  int n = raceIterations();
  int bad = 0;

  for (int i = 0; i < n; i++) {
    auto scope = Scope::create(1);
    auto op = Operation<double>::start(scope);
    std::atomic<int> cleanups{0}, early{0}, late{0};

    op->onSettled([&](const Operation<double>::Outcome&) { early++; });

    race([&] { op->succeed(1); },
         [&] { op->setCleanup([&] { cleanups++; }); },
         [&] { op->onSettled([&](const Operation<double>::Outcome& o) { late += *o.value == 1; }); });

    if (cleanups != 1 || early != 1 || late != 1) bad++;

    scope->dispose();
  }

  CHECK(bad == 0);
}

/// Two disposals, a child's disposal, registrations and new operations
/// racing: every cleanup runs once, and no operation is left pending.
static void concurrentDisposeRace() {
  int n = raceIterations();
  int bad = 0;

  for (int i = 0; i < n; i++) {
    auto scope = Scope::create(1);
    auto child = Scope::create(1, scope);
    std::atomic<int> cleanups{0}, childCleanups{0}, registered{0};
    std::vector<std::shared_ptr<Operation<double>>> ops(8);

    for (int k = 0; k < 4; k++) scope->onDispose([&] { cleanups++; });
    child->onDispose([&] { childCleanups++; });

    race([&] { scope->dispose(); },
         [&] { scope->dispose(); },
         [&] { child->dispose(); },
         [&] {
           for (int k = 0; k < 4; k++) {
             scope->onDispose([&] { cleanups++; });
             registered++;
           }
         },
         [&] {
           for (int k = 0; k < 8; k++) ops[k] = Operation<double>::start(scope);
         });

    bool ok = cleanups == 4 + registered && childCleanups == 1;
    ok = ok && scope->state() == Scope::State::Disposed && child->state() == Scope::State::Disposed;

    for (auto& op : ops) {
      ok = ok && op->state() == OperationState::Cancelled;
      ok = ok && !scope->validates(op->token());
    }

    if (!ok) bad++;
  }

  CHECK(bad == 0);
}

int main() {
  identities();
  cleanupsRunInReverseOnce();
  registrationAfterDisposeRunsNow();
  removeCleanups();
  cleanupErrorsAggregateLikeUsing();
  reentrantDisposeReturns();
  childScopes();
  childrenBelongToTheirParentsRuntime();
  registrationsCountWhatIsHeld();
  parentOwnsLiveChildren();
  destructionDisposes();
  tokensValidateAllFields();
  oneTransition();
  lateOutcomesAreReleased();
  cleanupRunsOnceAfterSettlement();
  listenersRunOnce();
  callbackErrorsAreReported();
  voidOperations();
  registration();
  disposalCancelsOperations();
  repeatedCallbacksAreCounted();
  idsAreNeverReused();
  droppedCallbacksMayReenter();
  settleCancelDisposeRace();
  cleanupAndListenerRegistrationRace();
  concurrentDisposeRace();

  std::printf("scope: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
