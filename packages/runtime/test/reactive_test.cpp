// Unit tests for the UI reactive graph (lucent/reactive.h): every scenario
// of the corpus reactive/corpus.ts writes, run here and compared line by
// line with the log the JavaScript reference gave, plus what the corpus
// cannot show (the owner context, the Lucent lock, identity of objects,
// threads). Built and run by `packages/runtime/test/run.sh`, which writes the
// corpus, also under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <future>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

#include <unistd.h>

#include "lucent/lucent.h"
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

/// Runs `f` as a turn of the UI (main) context and returns its result. The
/// test thread is in no context, so it may wait.
template <class F>
static auto onUi(F f) -> decltype(f()) {
  using R = decltype(f());
  std::promise<R> result;
  auto future = result.get_future();

  ExecutionContext::main().post([&] {
    if constexpr (std::is_void_v<R>) {
      f();
      result.set_value();
    } else {
      result.set_value(f());
    }
  });

  if (future.wait_for(std::chrono::seconds(10)) != std::future_status::ready) {
    std::fprintf(stderr, "a UI turn did not run within 10 s\n");
    std::abort();
  }

  return future.get();
}

static std::string message(std::exception_ptr e) { return currentError(e)->message.toUtf8(); }

/// The messages of an error and those it suppressed, in the order thrown.
static void messages(const Error& e, std::vector<std::string>& out) {
  if (auto* s = dynamic_cast<SuppressedErrorObject*>(e.get())) {
    messages(s->suppressed, out);
    messages(s->error, out);
    return;
  }

  out.push_back(e->message.toUtf8());
}

static std::string joined(std::exception_ptr e) {
  std::vector<std::string> list;
  messages(currentError(e), list);

  std::string out;
  for (auto& m : list) out += (out.empty() ? "" : "|") + m;
  return out;
}

// --- the corpus -----------------------------------------------------------------

static std::string formatNumber(double v) {
  if (v == 0 && std::signbit(v)) return "-0";
  return numberToString(v).toUtf8();
}

static double parseNumber(const std::string& s) {
  if (s == "NaN") return std::nan("");
  if (s == "-0") return -0.0;
  return std::stod(s);
}

using Tokens = std::vector<std::string>;

static Tokens tokenize(const std::string& line) {
  Tokens out;
  std::istringstream in(line);
  for (std::string t; in >> t;) out.push_back(t);
  return out;
}

/// The body in brackets at `at`, and the index after it.
static std::pair<Tokens, size_t> body(const Tokens& t, size_t at) {
  if (at >= t.size() || t[at] != "[") throw std::runtime_error("expected [");

  int depth = 0;
  for (size_t i = at; i < t.size(); i++) {
    if (t[i] == "[") depth++;
    if (t[i] == "]" && --depth == 0) return {Tokens(t.begin() + at + 1, t.begin() + i), i + 1};
  }

  throw std::runtime_error("unclosed [");
}

/// Runs a scenario (reactive/scenario.ts states the language) against the
/// runtime, logging what the reference logs.
class Runner {
 public:
  std::vector<std::string> run(const std::vector<std::string>& lines) {
    graph_ = ui::Graph::create(ExecutionContext::main(), ui::GraphOptions{20, [this](std::exception_ptr e, const char* where) {
                                                                             log_.push_back(std::string("error ") + where + " " + joined(e));
                                                                           }});

    std::vector<Tokens> list;
    for (auto& l : lines)
      if (auto t = tokenize(l); !t.empty()) list.push_back(t);

    steps(list, 0, list.size());

    // Everything ends, so nothing outlives the scenario; what that logs is not compared.
    std::vector<std::string> out = std::move(log_);
    for (auto& [id, mount] : mounts_) mount->dispose();
    graph_->dispose();

    return out;
  }

 private:
  std::shared_ptr<ui::Graph> graph_;
  std::vector<std::string> log_;
  std::map<std::string, ui::Signal<double>> signals_;
  std::map<std::string, ui::Computed<double>> computeds_;
  std::map<std::string, std::shared_ptr<Scope>> mounts_;
  std::map<std::string, ui::Effect> effects_;
  std::map<std::string, std::shared_ptr<Operation<void>>> tasks_;

  double read(const std::string& id, bool tracked) {
    if (auto s = signals_.find(id); s != signals_.end()) return tracked ? s->second.get() : s->second.peek();
    if (auto c = computeds_.find(id); c != computeds_.end()) return tracked ? c->second.get() : c->second.peek();
    throw std::runtime_error("no signal or computed " + id);
  }

  ui::Signal<double>& signal(const std::string& id) {
    auto s = signals_.find(id);
    if (s == signals_.end()) throw std::runtime_error("no signal " + id);
    return s->second;
  }

  double exec(const std::string& label, const Tokens& b) {
    double sum = 0;
    size_t i = 0;

    while (i < b.size()) {
      const std::string& op = b[i];

      if (op == "read" || op == "peek") {
        sum += read(b[i + 1], op == "read");
        i += 2;
      } else if (op == "add") {
        sum += parseNumber(b[i + 1]);
        i += 2;
      } else if (op == "if") {
        double v = read(b[i + 1], true);
        double k = parseNumber(b[i + 2]);
        auto yes = body(b, i + 3);
        auto no = body(b, yes.second);
        sum += exec(label, v < k ? yes.first : no.first);
        i = no.second;
      } else if (op == "write") {
        signal(b[i + 1]).set(std::fmod(sum + parseNumber(b[i + 2]), 1000));
        i += 3;
      } else if (op == "set") {
        signal(b[i + 1]).set(parseNumber(b[i + 2]));
        i += 3;
      } else if (op == "cleanup" || op == "cleanupthrow") {
        std::string tag = b[i + 1];
        bool throws = op == "cleanupthrow";
        graph_->onCleanup([this, label, tag, throws] {
          log_.push_back("cleanup " + label + " " + tag);
          if (throws) throwError(String::fromLatin1("Error"), String::fromUtf8(tag));
        });
        i += 2;
      } else if (op == "cleanupset") {
        ui::Signal<double> target = signal(b[i + 1]);
        double v = parseNumber(b[i + 2]);
        graph_->onCleanup([target, v] { target.set(v); });
        i += 3;
      } else if (op == "cleanupread") {
        std::string id = b[i + 1];
        graph_->onCleanup([this, label, id] { log_.push_back("cleanup " + label + " read " + id + " = " + formatNumber(read(id, true))); });
        i += 2;
      } else if (op == "effect") {
        std::string id = b[i + 1];
        auto inner = body(b, i + 2);
        makeEffect(id, inner.first);
        i = inner.second;
      } else if (op == "task") {
        std::string id = b[i + 1];
        auto then = body(b, i + 2);
        auto task = Operation<void>::start(graph_->scope());
        tasks_[id] = task;
        task->onSettled([this, id, then = then.first](const Operation<void>::Outcome& outcome) {
          if (outcome.state == OperationState::Cancelled) {
            log_.push_back("task " + id + " cancelled");
            return;
          }

          try {
            log_.push_back("task " + id + " done = " + formatNumber(exec(id, then)));
          } catch (...) {
            log_.push_back("task " + id + " throws " + message(std::current_exception()));
          }
        });
        i = then.second;
      } else if (op == "throw") {
        throwError(String::fromLatin1("Error"), String::fromUtf8(b[i + 1]));
      } else {
        throw std::runtime_error("unknown body step " + op);
      }
    }

    return sum;
  }

  void makeEffect(const std::string& id, const Tokens& b) {
    effects_[id] = ui::effect(
        graph_,
        [this, id, b] {
          double sum = exec(id, b);
          log_.push_back("run " + id + " = " + formatNumber(sum));
        },
        id);
  }

  void steps(const std::vector<Tokens>& list, size_t from, size_t to) {
    size_t i = from;

    while (i < to) {
      if (list[i][0] == "begin") {
        int depth = 0;
        size_t end = i;
        for (; end < to; end++) {
          if (list[end][0] == "begin") depth++;
          if (list[end][0] == "commit" && --depth == 0) break;
        }

        graph_->transaction([&] { steps(list, i + 1, end); });
        i = end + 1;
        continue;
      }

      step(list[i]);
      i++;
    }
  }

  void step(const Tokens& t) {
    const std::string& op = t[0];

    if (op == "signal") {
      signals_.emplace(t[1], ui::signal(graph_, parseNumber(t[2])));
    } else if (op == "computed") {
      std::string id = t[1];
      Tokens b = body(t, 2).first;
      computeds_.emplace(id, ui::computed(graph_, [this, id, b] {
                           try {
                             double sum = exec(id, b);
                             log_.push_back("eval " + id + " = " + formatNumber(sum));
                             return sum;
                           } catch (...) {
                             log_.push_back("eval " + id + " throws " + message(std::current_exception()));
                             throw;
                           }
                         }));
    } else if (op == "mount") {
      mounts_[t[1]] = Scope::create(0);
    } else if (op == "effect") {
      graph_->within(mounts_.at(t[2]), [&] { makeEffect(t[1], body(t, 3).first); });
    } else if (op == "cleanup") {
      std::string id = t[1], tag = t[2];
      graph_->within(mounts_.at(id), [&] { graph_->onCleanup([this, id, tag] { log_.push_back("cleanup " + id + " " + tag); }); });
    } else if (op == "write") {
      signal(t[1]).set(parseNumber(t[2]));
    } else if (op == "read") {
      try {
        log_.push_back("read " + t[1] + " = " + formatNumber(read(t[1], false)));
      } catch (...) {
        log_.push_back("read " + t[1] + " throws " + message(std::current_exception()));
      }
    } else if (op == "unmount") {
      auto errors = graph_->transaction([&] { return mounts_.at(t[1])->dispose(); });
      if (errors) log_.push_back("error unmount " + joined(errors));
    } else if (op == "dispose") {
      effects_.at(t[1]).dispose();
    } else if (op == "complete") {
      auto task = tasks_.find(t[1]);
      if (task == tasks_.end())
        log_.push_back("task " + t[1] + " none");
      else if (!task->second->succeed())
        log_.push_back("task " + t[1] + " dropped");
    } else {
      throw std::runtime_error("unknown step " + op);
    }
  }
};

struct Scenario {
  std::string name;
  std::vector<std::string> steps;
  std::vector<std::string> expected;
};

static std::vector<Scenario> readCorpus(const char* path) {
  std::ifstream in(path);
  if (!in) {
    std::fprintf(stderr, "cannot read the corpus at %s\n", path);
    std::exit(1);
  }

  std::vector<Scenario> out;
  Scenario current;
  bool expecting = false;

  for (std::string line; std::getline(in, line);) {
    if (line.rfind("scenario ", 0) == 0) {
      current = Scenario{line.substr(9), {}, {}};
      expecting = false;
    } else if (line == "expect") {
      expecting = true;
    } else if (line == "end") {
      out.push_back(std::move(current));
    } else {
      (expecting ? current.expected : current.steps).push_back(line);
    }
  }

  return out;
}

/// Every scenario, on the UI context, against the reference's log.
static void corpus(const char* path) {
  auto scenarios = readCorpus(path);
  int wrong = 0;

  for (auto& s : scenarios) {
    std::vector<std::string> actual;
    std::string crashed;

    onUi([&] {
      try {
        actual = Runner().run(s.steps);
      } catch (...) {
        crashed = message(std::current_exception());
      }
    });

    checks++;
    if (crashed.empty() && actual == s.expected) continue;

    failures++;
    if (wrong++ >= 5) continue;

    std::fprintf(stderr, "reactive: scenario \"%s\" disagrees with the reference%s%s\n", s.name.c_str(), crashed.empty() ? "" : ": ",
                 crashed.c_str());
    for (size_t i = 0; i < std::max(actual.size(), s.expected.size()); i++) {
      const char* a = i < actual.size() ? actual[i].c_str() : "(nothing)";
      const char* e = i < s.expected.size() ? s.expected[i].c_str() : "(nothing)";
      if (actual.size() <= i || s.expected.size() <= i || actual[i] != s.expected[i]) {
        std::fprintf(stderr, "  line %zu: runtime \"%s\", reference \"%s\"\n", i + 1, a, e);
        break;
      }
    }
  }

  std::printf("reactive: %zu corpus scenarios, %d disagree with the reference\n", scenarios.size(), wrong);
}

// --- what the corpus cannot show ---------------------------------------------------

/// Errors, by where they came from.
struct Reports {
  std::vector<std::string> list;

  ui::GraphOptions options(uint32_t loopLimit = 100) {
    return ui::GraphOptions{loopLimit, [this](std::exception_ptr e, const char* where) { list.push_back(std::string(where) + ": " + joined(e)); }};
  }
};

/// The graph belongs to its context: used from anywhere else, it throws.
static void ownedByItsContext() {
  auto g = onUi([] { return ui::Graph::create(); });
  auto s = onUi([&] { return ui::signal(g, 1.0); });

  auto refused = [](auto f) {
    try {
      f();
    } catch (const std::logic_error&) {
      return true;
    }
    return false;
  };

  CHECK(refused([&] { s.set(2); }));
  CHECK(refused([&] { (void)s.get(); }));
  CHECK(refused([&] { g->transaction([] {}); }));
  CHECK(refused([&] { ui::effect(g, [] {}); }));
  CHECK(onUi([&] { return s.peek(); }) == 1);

  onUi([&] { g->dispose(); });
}

/// Updates run on the UI context while another thread holds the Lucent
/// lock: nothing waits for the module lock or the JS thread.
static void independentOfTheLucentLock() {
  auto& lock = Actor::shared().lock();
  lock.lock();

  std::vector<double> seen = onUi([] {
    auto g = ui::Graph::create();
    auto s = ui::signal(g, 1.0);
    auto twice = ui::computed(g, [s] { return s.get() * 2; });
    std::vector<double> out;

    ui::effect(g, [&out, twice] { out.push_back(twice.get()); });
    g->transaction([&] { s.set(5); });

    g->dispose();
    return out;
  });

  lock.unlock();

  CHECK((seen == std::vector<double>{2, 10}));
}

struct Holder : Object {
  double value = 0;
};

/// Objects notify by identity: mutating one in place and setting it again
/// changes nothing; a new object does, even with the same content.
static void objectsByIdentity() {
  int runs = onUi([] {
    auto g = ui::Graph::create();
    auto box = std::make_shared<Holder>();
    auto s = ui::signal<Ref<Holder>>(g, box);
    int count = 0;

    ui::effect(g, [&count, s] {
      count++;
      (void)s.get();
    });

    box->value = 5;
    s.set(box);

    auto copy = std::make_shared<Holder>();
    copy->value = 5;
    s.set(copy);

    g->dispose();
    return count;
  });

  CHECK(runs == 2);
}

/// Missing, null and a value stay distinct (Opt), and an equality given at
/// the signal replaces Object.is.
static void optionalsAndCustomEquality() {
  auto result = onUi([] {
    auto g = ui::Graph::create();
    auto prop = ui::signal<Opt<double>>(g, Opt<double>());
    auto rounded = ui::signal<double>(g, 1.2, [](const double& a, const double& b) { return std::round(a) == std::round(b); });
    std::vector<std::string> log;

    ui::effect(g, [&log, prop] {
      Opt<double> v = prop.get();
      log.push_back(v.isUndefined() ? "missing" : v.isNull() ? "null" : formatNumber(v.get()));
    });
    ui::effect(g, [&log, rounded] { log.push_back("rounded " + formatNumber(rounded.get())); });

    prop.set(Opt<double>(Null{}));
    prop.set(Opt<double>(Null{}));
    prop.set(Opt<double>(0.0));
    prop.set(Opt<double>(-0.0));
    prop.set(Opt<double>());
    rounded.set(1.4);
    rounded.set(2.2);

    g->dispose();
    return log;
  });

  CHECK((result == std::vector<std::string>{"missing", "rounded 1.2", "null", "0", "-0", "missing", "rounded 2.2"}));
}

/// A computed value reading itself throws a RangeError, not a hang or a crash.
static void computedCycles() {
  std::string error = onUi([] {
    auto g = ui::Graph::create();
    auto self = std::make_shared<std::function<double()>>();
    auto c = ui::computed(g, [self] { return (*self)(); });
    *self = [c] { return c.get(); };

    std::string out;
    try {
      (void)c.get();
    } catch (...) {
      Error e = currentError(std::current_exception());
      out = e->name.toUtf8() + ": " + e->message.toUtf8();
    }

    // The function holds the computed that holds it: a cycle LeakSanitizer reports.
    *self = nullptr;
    g->dispose();
    return out;
  });

  CHECK(error == "RangeError: A computed value reads itself");
}

/// Effects live as long as their scope, whether or not their handle is kept;
/// disposing the graph ends those made outside any mount.
static void effectsLiveWithTheirScope() {
  auto result = onUi([] {
    auto g = ui::Graph::create();
    auto s = ui::signal(g, 0.0);
    auto mount = Scope::create(0);
    std::vector<std::string> log;

    g->within(mount, [&] { ui::effect(g, [&log, s] { log.push_back("mounted " + formatNumber(s.get())); }); });
    ui::effect(g, [&log, s] { log.push_back("root " + formatNumber(s.get())); });

    s.set(1);
    mount->dispose();
    s.set(2);
    g->dispose();
    s.set(3);

    return log;
  });

  CHECK((result == std::vector<std::string>{"mounted 0", "root 0", "mounted 1", "root 1", "root 2"}));
}

/// A mount scope under the UI context's root, disposed from another thread:
/// its effects' cleanups run on the UI context, and they never run again.
static void disposedFromAnotherThread() {
  std::atomic<bool> cleanedOnUi{false};
  std::atomic<int> runs{0};

  auto [g, s, mount] = onUi([&] {
    auto g = ui::Graph::create();
    auto s = ui::signal(g, 0.0);
    auto mount = Scope::create(0, ExecutionContext::main().root());

    g->within(mount, [&] {
      ui::effect(g, [&runs, &cleanedOnUi, s, g] {
        runs++;
        (void)s.get();
        g->onCleanup([&] { cleanedOnUi = ExecutionContext::main().isCurrent(); });
      });
    });

    return std::make_tuple(g, s, mount);
  });

  mount->dispose();
  onUi([&] { s.set(1); });

  CHECK(cleanedOnUi.load());
  CHECK(runs.load() == 1);

  onUi([&] { g->dispose(); });
}

/// An effect's error, its cleanups' and a loop's reach onError with where
/// they came from; by default, reportUncaught.
static void errorsSayWhere() {
  Reports reports;

  onUi([&] {
    auto g = ui::Graph::create(ExecutionContext::main(), reports.options(3));
    auto t = ui::signal(g, 0.0);
    auto s = ui::signal(g, 0.0);

    ui::effect(g, [t, g] {
      g->onCleanup([] { throwError(String::fromLatin1("Error"), String::fromLatin1("cleanup")); });
      if (t.get() == 1) throwError(String::fromLatin1("Error"), String::fromLatin1("body"));
    });
    t.set(1);

    ui::effect(g, [s] { s.set(s.get() + 1); }, "grow");

    g->dispose();
  });

  CHECK((reports.list == std::vector<std::string>{"effect cleanup: cleanup", "effect: body",
                                                  "effect loop: Effects kept rerunning: grow -> grow (grow ran 3 times in one update)",
                                                  "effect cleanup: cleanup"}));
}

// --- prop commits -------------------------------------------------------------------

/// Holds the UI context busy until released, then runs `then` there, so
/// what is posted meanwhile queues behind it.
struct UiHold {
  std::promise<void> release;
  std::promise<void> started;

  explicit UiHold(std::function<void()> then = [] {}) {
    auto go = std::make_shared<std::shared_future<void>>(release.get_future().share());
    ExecutionContext::main().post([this, go, then] {
      started.set_value();
      go->wait();
      then();
    });
    started.get_future().wait();
  }

  void done() { release.set_value(); }
};

/// A mount with `min` and `max` props and an effect that records each pair
/// it sees.
struct PairView {
  std::shared_ptr<ui::Graph> graph;
  std::shared_ptr<Scope> mount;
  std::shared_ptr<ui::PropInbox> inbox;
  std::optional<ui::Signal<double>> min, max;
  std::vector<std::pair<double, double>> seen;

  PairView() {
    onUi([this] {
      graph = ui::Graph::create();
      mount = Scope::create(0, ExecutionContext::main().root());
      min = ui::signal(graph, 0.0);
      max = ui::signal(graph, 10.0);
      inbox = ui::PropInbox::create(graph, mount);

      graph->within(mount, [&] { ui::effect(graph, [this] { seen.emplace_back(min->get(), max->get()); }); });
    });
  }

  ui::PropInbox::Commit commit(std::optional<double> lo, std::optional<double> hi) {
    ui::PropInbox::Commit c;
    if (lo) c.push_back({0, [s = *min, v = *lo] { s.set(v); }});
    if (hi) c.push_back({1, [s = *max, v = *hi] { s.set(v); }});
    return c;
  }

  ~PairView() {
    onUi([this] {
      mount->dispose();
      graph->dispose();
    });
  }
};

/// Commits from another thread reach the UI as one transaction: an effect
/// reading both props never sees half of one, nor a pair no commit had.
static void commitsApplyWhole() {
  PairView view;

  UiHold hold;
  CHECK(view.inbox->post(view.commit(0, 10)));
  CHECK(view.inbox->post(view.commit(20, 30)));
  CHECK(view.inbox->post(view.commit(std::nullopt, 40)));
  hold.done();

  onUi([] {});

  CHECK((view.seen == std::vector<std::pair<double, double>>{{0, 10}, {20, 40}}));
  CHECK(view.inbox->stats().commits == 3);
  CHECK(view.inbox->stats().applied == 1);
}

/// Code on the UI that must answer now (a command, a measurement) applies
/// what is pending first, without waiting for the posted application.
static void drainAnswersNow() {
  PairView view;
  std::pair<double, double> answered;

  UiHold command([&] {
    view.inbox->drain();
    answered = {view.min->peek(), view.max->peek()};
  });
  view.inbox->post(view.commit(5, 50));
  command.done();

  onUi([] {});
  CHECK((answered == std::pair<double, double>{5, 50}));
  CHECK(view.inbox->stats().applied == 1);

  view.inbox->post(view.commit(6, std::nullopt));
  onUi([] {});
  CHECK((view.seen.back() == std::pair<double, double>{6, 50}));
  CHECK(onUi([&] { return view.inbox->drain(); }) == false);
}

/// Once the mount is disposed, commits are refused, and pending ones are
/// dropped, never applied to what the mount left behind.
static void commitsEndWithTheMount() {
  PairView view;

  UiHold unmount([&] { view.mount->dispose(); });
  CHECK(view.inbox->post(view.commit(1, 2)));
  unmount.done();

  onUi([] {});

  CHECK(view.inbox->closed());
  CHECK(!view.inbox->post(view.commit(3, 4)));
  CHECK(onUi([&] { return view.min->peek(); }) == 0);
  CHECK((view.seen == std::vector<std::pair<double, double>>{{0, 10}}));
}

/// Many threads committing at once: every field ends at its last commit,
/// and each application shows every field no older than the one before.
static void concurrentCommits() {
  const char* n = std::getenv("LUCENT_RACE_ITERATIONS");
  int rounds = n ? std::atoi(n) / 10 + 1 : 20;
  bool ordered = true, final = true;

  for (int r = 0; r < rounds; r++) {
    auto g = onUi([] { return ui::Graph::create(); });
    auto mount = onUi([] { return Scope::create(0, ExecutionContext::main().root()); });
    std::vector<ui::Signal<double>> fields;
    std::vector<std::vector<double>> seen(4);

    onUi([&] {
      for (int f = 0; f < 4; f++) fields.push_back(ui::signal(g, 0.0));
      g->within(mount, [&] {
        ui::effect(g, [&] {
          for (int f = 0; f < 4; f++) seen[f].push_back(fields[f].get());
        });
      });
    });
    auto inbox = onUi([&] { return ui::PropInbox::create(g, mount); });

    std::vector<std::thread> threads;
    for (int f = 0; f < 4; f++)
      threads.emplace_back([&, f] {
        for (int v = 1; v <= 50; v++) inbox->post({{static_cast<uint32_t>(f), [s = fields[f], v] { s.set(v); }}});
      });
    for (auto& t : threads) t.join();

    onUi([&] {
      inbox->drain();
      for (int f = 0; f < 4; f++) {
        final = final && fields[f].peek() == 50;
        for (size_t i = 1; i < seen[f].size(); i++) ordered = ordered && seen[f][i] >= seen[f][i - 1];
      }
      mount->dispose();
      g->dispose();
    });
  }

  CHECK(final);
  CHECK(ordered);
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

/// Without onError, an effect's error goes to reportUncaught.
static void reportedUncaughtByDefault() {
  StderrCapture capture;

  onUi([] {
    auto g = ui::Graph::create();
    ui::effect(g, [] { throwError(String::fromLatin1("Error"), String::fromLatin1("nobody catches this")); });
    g->dispose();
  });

  std::string text = capture.finish();
  CHECK(text.find("uncaught exception in effect: Error: nobody catches this") != std::string::npos);
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: reactive_test <corpus>\n");
    return 1;
  }

  corpus(argv[1]);
  ownedByItsContext();
  independentOfTheLucentLock();
  objectsByIdentity();
  optionalsAndCustomEquality();
  computedCycles();
  effectsLiveWithTheirScope();
  disposedFromAnotherThread();
  errorsSayWhere();
  reportedUncaughtByDefault();
  commitsApplyWhole();
  drainAnswersNow();
  commitsEndWithTheMount();
  concurrentCommits();

  std::printf("reactive: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
