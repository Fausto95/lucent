// Lucent runtime — the UI's reactive graph: signals, computed values and
// effects, owned by one execution context (a view's: the main context).
//
// Everything runs on that context and nothing else: every call from another
// thread throws std::logic_error (handles may be copied anywhere, but the
// last copy of a computed value or an effect must go there too), and
// nothing waits for the Lucent lock or the JavaScript thread. The rules
// (docs/architecture.md, under reactive.h; test/reactive/reference.ts is
// their executable statement):
//
// - A signal notifies when a write changes its value by Object.is (NaN is
//   itself, 0 and -0 differ; objects by identity: mutating one in place
//   notifies nothing). A signal may take another equality.
// - A computed value is lazy: evaluated when read, again only when a source
//   it read last time changed since. An unchanged result changes nothing
//   downstream; an error is kept and rethrown to readers until a source
//   changes. It cannot write a signal, nor read itself.
// - An effect runs once when made, then again after something it read
//   changed. Each run replaces what the last one read. Before it reruns, and
//   when it is disposed, its last run's scope is disposed, untracked: tasks
//   started in it cancelled, then its cleanups and nested effects in
//   reverse order.
// - Writes inside a transaction, an effect or a cleanup wait for it to end;
//   the outermost end runs the pending effects at once, in the order they
//   were made, so no effect sees half of a transaction. An effect about to
//   run more than `loopLimit` times in one update stops it and is reported
//   with the effects that triggered each other.
// - Only the synchronous run tracks: cleanups, untracked(), and whatever runs
//   later (a continuation after an await) read without subscribing.
#pragma once

#include <cmath>
#include <cstdint>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

#include "core.h"
#include "equality.h"
#include "execution.h"
#include "jserror.h"
#include "scope.h"

namespace lucent::trace {
struct Site;
}  // namespace lucent::trace

namespace lucent::ui {

/// Object.is: NaN is itself, 0 and -0 differ.
inline bool sameValue(double a, double b) {
  if (std::isnan(a)) return std::isnan(b);
  return a == b && std::signbit(a) == std::signbit(b);
}

/// Missing, null and a value differ; values by Object.is.
template <class T>
bool sameValue(const Opt<T>& a, const Opt<T>& b);

/// Otherwise `===`: identity for objects, never their content.
template <class T>
bool sameValue(const T& a, const T& b) {
  return strictEquals(a, b);
}

template <class T>
bool sameValue(const Opt<T>& a, const Opt<T>& b) {
  return a.state() == b.state() && (!a.has() || sameValue(a.get(), b.get()));
}

/// A signal's or computed value's default equality.
struct SameValue {
  template <class T>
  bool operator()(const T& a, const T& b) const {
    return sameValue(a, b);
  }
};

template <class T>
using Equality = std::function<bool(const T&, const T&)>;

struct GraphOptions {
  /// Runs one effect may make in one update before the update stops as a loop.
  uint32_t loopLimit = 100;

  /// Errors no caller can catch: an effect's ("effect"), its cleanups'
  /// ("effect cleanup"), a loop ("effect loop"). Default: reportUncaught.
  std::function<void(std::exception_ptr error, const char* where)> onError;
};

namespace detail {
class Node;
class Observer;
class EffectNode;
template <class T>
class ComputedNode;
}  // namespace detail

template <class T>
class Signal;
template <class T>
class Computed;
class Effect;
class Graph;

/// Makes an effect in graph->scope() and runs it at once. `name` names it in
/// loop reports, and each run is a trace span at `site` (its .lucent.ts
/// line). Made in a scope that is no longer active, it never runs.
Effect effect(const std::shared_ptr<Graph>& graph, std::function<void()> fn, std::string name = "effect",
              const trace::Site* site = nullptr);

class Graph : public std::enable_shared_from_this<Graph> {
  struct Token {};

 public:
  /// A graph owned by `owner`, used only there.
  static std::shared_ptr<Graph> create(ExecutionContext& owner = ExecutionContext::main(), GraphOptions options = {});

  Graph(Token, ExecutionContext& owner, GraphOptions options);
  Graph(const Graph&) = delete;
  Graph& operator=(const Graph&) = delete;

  ExecutionContext& owner() const { return owner_; }

  /// Where effects made outside any mount belong; dispose() ends it.
  const std::shared_ptr<Scope>& root() const { return root_; }

  /// Where effects, cleanups and tasks made now belong: the running effect's
  /// run, the scope of within(), else the root.
  const std::shared_ptr<Scope>& scope() const {
    checkOwner();
    return scope_;
  }

  /// Runs `f`; its writes, and the effects they make pending, wait for the
  /// outermost transaction to end, which runs the pending effects before
  /// returning. Not a rollback: what `f` wrote before throwing stays.
  template <class F>
  decltype(auto) transaction(F&& f) {
    checkOwner();
    Batch batch(*this);
    return std::forward<F>(f)();
  }

  /// Runs `f` without subscribing whatever is running to what it reads.
  template <class F>
  decltype(auto) untracked(F&& f) {
    checkOwner();
    Tracking none(*this, nullptr);
    return std::forward<F>(f)();
  }

  /// Runs `f` with `scope` as where effects and cleanups made belong (a
  /// view mount's setup).
  template <class F>
  decltype(auto) within(const std::shared_ptr<Scope>& scope, F&& f) {
    checkOwner();
    if (!scope) throw std::invalid_argument("within() needs a scope");
    ScopeSwap swap(*this, scope);
    return std::forward<F>(f)();
  }

  /// Registers a cleanup with scope(): it runs when that scope is disposed
  /// (before the running effect's next run), untracked.
  void onCleanup(std::function<void()> cleanup);

  /// Disposes the root: effects made outside any mount end.
  void dispose();

  /// Throws std::logic_error unless called on the owner context.
  void checkOwner() const;

 private:
  template <class T>
  friend class Signal;
  template <class T>
  friend class Computed;
  template <class T>
  friend class detail::ComputedNode;
  friend class detail::Observer;
  friend class Effect;
  friend Effect effect(const std::shared_ptr<Graph>& graph, std::function<void()> fn, std::string name,
                       const trace::Site* site);

  /// Writes wait while one lives; the outermost runs the pending effects.
  struct Batch {
    explicit Batch(Graph& g) : g(g) { g.batch_++; }
    ~Batch() {
      if (--g.batch_ == 0) g.flushPending();
    }
    Graph& g;
  };

  /// What reads subscribe, while one lives.
  struct Tracking {
    Tracking(Graph& g, detail::Observer* observer) : g(g), outer(g.tracker_) { g.tracker_ = observer; }
    ~Tracking() { g.tracker_ = outer; }
    Graph& g;
    detail::Observer* outer;
  };

  struct ScopeSwap {
    ScopeSwap(Graph& g, std::shared_ptr<Scope> scope) : g(g), outer(std::exchange(g.scope_, std::move(scope))) {}
    ~ScopeSwap() { g.scope_ = std::move(outer); }
    Graph& g;
    std::shared_ptr<Scope> outer;
  };

  /// A read: subscribes the tracking observer.
  void read(detail::Node& node);
  /// A signal's value changed: marks what depends on it, and runs the
  /// pending effects unless writes wait.
  void changed(detail::Node& node);
  void mark(detail::Node& node);
  void enqueue(detail::EffectNode& effect);
  void flushPending();
  void runEffect(detail::EffectNode& effect);
  void disposeEffect(detail::EffectNode& effect);
  void loop(detail::EffectNode& effect);
  void report(std::exception_ptr error, const char* where);
  /// Throws InvalidStateError while a computed value is being evaluated.
  void checkWritable() const;

  ExecutionContext& owner_;
  std::weak_ptr<Scope::Owner> ownerRef_;
  GraphOptions options_;
  std::shared_ptr<Scope> root_;
  std::shared_ptr<Scope> scope_;

  detail::Observer* tracker_ = nullptr;
  detail::EffectNode* running_ = nullptr;
  uint32_t batch_ = 0;
  uint32_t computing_ = 0;
  bool flushing_ = false;

  /// Each write's marks, so a node is visited once per write.
  uint64_t epoch_ = 0;
  /// Each update (flush), for counting an effect's runs in it.
  uint64_t updates_ = 0;
  /// Effects made, which orders them.
  uint64_t made_ = 0;

  /// Pending effects, in the order they were made.
  std::map<uint64_t, std::shared_ptr<detail::EffectNode>> queue_;
};

namespace detail {

class Node : public std::enable_shared_from_this<Node> {
 public:
  explicit Node(std::shared_ptr<Graph> graph) : graph_(std::move(graph)) {}
  virtual ~Node() = default;
  Node(const Node&) = delete;
  Node& operator=(const Node&) = delete;

  /// Brings a computed value up to date; a signal always is.
  virtual void refresh() {}

  std::shared_ptr<Graph> graph_;
  /// Changes with the value (a computed value's error counts as a change).
  uint64_t version_ = 0;
  std::vector<Observer*> observers_;
};

/// A computed value or an effect: what it read, with the versions it read.
class Observer : public Node {
 public:
  Observer(std::shared_ptr<Graph> graph, bool effect) : Node(std::move(graph)), effect_(effect) {}
  ~Observer() override;

  /// Whether a source changed since it was read (computed sources brought
  /// up to date first, in the order read).
  bool stale();

  /// A read during a run: the first read of a source keeps its version.
  void track(Node& source);

  void begin() { next_.clear(); }
  /// The run's reads replace the last run's.
  void finish();
  void unlinkAll();

  struct Edge {
    std::shared_ptr<Node> source;
    uint64_t version;
  };

  /// Edges in the order read, with a hashed index once there are more than
  /// a few, so a run reading n sources costs O(n), not O(n²).
  class Edges {
   public:
    bool has(const Node* node) const;
    void add(Edge edge);
    void clear();

    std::vector<Edge>::iterator begin() { return list_.begin(); }
    std::vector<Edge>::iterator end() { return list_.end(); }

   private:
    static constexpr size_t kLinear = 8;

    std::vector<Edge> list_;
    std::unordered_set<const Node*> index_;
  };

  const bool effect_;
  Edges sources_;
  Edges next_;
  /// Never run yet.
  bool fresh_ = true;
  /// Something it depends on was written since it was last up to date.
  bool maybeStale_ = true;
  uint64_t mark_ = 0;
};

class EffectNode final : public Observer {
 public:
  EffectNode(std::shared_ptr<Graph> graph, std::function<void()> fn, std::string name, uint64_t order,
             const trace::Site* site)
      : Observer(std::move(graph), true), fn_(std::move(fn)), name_(std::move(name)), order_(order), site_(site) {}

  std::function<void()> fn_;
  const std::string name_;
  const uint64_t order_;
  /// Where its runs show in a trace (static, as trace events are).
  const trace::Site* const site_;

  /// The last run's scope: its tasks, cleanups and nested effects.
  std::shared_ptr<Scope> run_;
  RuntimeId runtime_ = 0;
  std::weak_ptr<Scope> owner_;
  Scope::CleanupId registration_ = 0;

  bool queued_ = false;
  bool disposed_ = false;
  /// The effect running when this one was made pending (for loop reports).
  std::weak_ptr<EffectNode> cause_;
  uint64_t update_ = 0;
  uint32_t runs_ = 0;
};

template <class T>
class SignalNode final : public Node {
 public:
  SignalNode(std::shared_ptr<Graph> graph, T value, Equality<T> equals)
      : Node(std::move(graph)), value_(std::move(value)), equals_(std::move(equals)) {}

  T value_;
  Equality<T> equals_;
};

template <class T>
class ComputedNode final : public Observer {
 public:
  ComputedNode(std::shared_ptr<Graph> graph, std::function<T()> fn, Equality<T> equals)
      : Observer(std::move(graph), false), fn_(std::move(fn)), equals_(std::move(equals)) {}

  void refresh() override {
    if (!maybeStale_) return;
    if (stale()) recompute();
    maybeStale_ = false;
  }

  void recompute() {
    Graph& g = *graph_;
    std::optional<T> value;
    std::exception_ptr error;

    begin();
    computing_ = true;
    g.computing_++;
    {
      Graph::Tracking tracking(g, this);
      try {
        value.emplace(fn_());
      } catch (...) {
        error = std::current_exception();
      }
    }
    g.computing_--;
    computing_ = false;
    finish();
    fresh_ = false;

    if (error) {
      error_ = error;
      version_++;
      return;
    }

    bool changed = error_ || !value_ || !equals_(*value_, *value);
    error_ = nullptr;

    if (changed) {
      value_ = std::move(value);
      version_++;
    }
  }

  std::function<T()> fn_;
  Equality<T> equals_;
  std::optional<T> value_;
  std::exception_ptr error_;
  bool computing_ = false;
};

}  // namespace detail

/// A value the UI tracks. Copies are the same signal.
template <class T>
class Signal {
 public:
  /// Empty, until one is assigned (a field of a Lucent object): using it throws.
  Signal() = default;
  explicit Signal(std::shared_ptr<detail::SignalNode<T>> node) : node_(std::move(node)) {}

  /// The value; the running effect or computed value now depends on it.
  T get() const {
    Graph& g = *node().graph_;
    g.checkOwner();
    g.read(*node_);
    return node_->value_;
  }

  /// The value, without depending on it.
  T peek() const {
    node().graph_->checkOwner();
    return node_->value_;
  }

  /// The same signal: copies share one.
  const void* identity() const { return node_.get(); }

  /// Notifies what read it, unless `value` equals the current one.
  void set(T value) const {
    Graph& g = *node().graph_;
    g.checkOwner();
    g.checkWritable();

    if (node_->equals_(node_->value_, value)) return;

    node_->value_ = std::move(value);
    g.changed(*node_);
  }

 private:
  detail::SignalNode<T>& node() const {
    if (!node_) throw std::logic_error("A Signal is used before one was assigned to it");
    return *node_;
  }

  std::shared_ptr<detail::SignalNode<T>> node_;
};

/// A value derived from others, evaluated lazily. Copies are the same one.
template <class T>
class Computed {
 public:
  explicit Computed(std::shared_ptr<detail::ComputedNode<T>> node) : node_(std::move(node)) {}

  /// The value, up to date; the running effect or computed value now
  /// depends on it. Rethrows the evaluation's error.
  T get() const {
    Graph& g = *node_->graph_;
    g.checkOwner();

    if (node_->computing_) throwError(String::fromLatin1("RangeError"), String::fromLatin1("A computed value reads itself"));

    node_->refresh();
    g.read(*node_);

    if (node_->error_) std::rethrow_exception(node_->error_);
    return *node_->value_;
  }

  /// get(), without depending on it.
  T peek() const {
    return node_->graph_->untracked([this] { return get(); });
  }

 private:
  std::shared_ptr<detail::ComputedNode<T>> node_;
};

/// An effect: lives until disposed, or until the scope it was made in is.
class Effect {
 public:
  Effect() = default;
  explicit Effect(std::shared_ptr<detail::EffectNode> node) : node_(std::move(node)) {}

  /// Ends it now: its last run's scope is disposed, and it never runs again.
  void dispose() const;
  bool disposed() const { return !node_ || node_->disposed_; }

 private:
  std::shared_ptr<detail::EffectNode> node_;
};

/// A mount's prop commits, on their way from React to the UI context. A
/// commit is the fields that changed since the previous one (a field left
/// out is unchanged; missing and null are values the write sets), each a
/// write of an already converted value into the field's signal. Commits
/// posted from any thread coalesce until the UI applies them, all at once in
/// one transaction, fields in their order: a field's later write replaces
/// its earlier one, and effects see one committed state. A job posted with
/// the first pending commit applies them; code on the UI that must answer
/// now (a command, a measurement) calls drain() first instead of waiting.
/// Disposing the mount closes it: pending commits are dropped, new ones
/// refused.
class PropInbox : public std::enable_shared_from_this<PropInbox> {
  struct Token {};

 public:
  struct Change {
    uint32_t field;
    std::function<void()> write;
  };
  using Commit = std::vector<Change>;

  struct Stats {
    /// Commits posted and taken.
    uint64_t commits = 0;
    /// Applications: transactions that applied pending commits.
    uint64_t applied = 0;
  };

  /// On the graph's context: an inbox for `mount`'s props.
  static std::shared_ptr<PropInbox> create(std::shared_ptr<Graph> graph, const std::shared_ptr<Scope>& mount);

  PropInbox(Token, std::shared_ptr<Graph> graph, const std::shared_ptr<Scope>& mount);

  /// Any thread. False, keeping nothing, once closed.
  bool post(Commit commit);

  /// On the graph's context: applies what is pending now. False if nothing was.
  bool drain();

  /// Any thread; idempotent. Drops what is pending.
  void close();

  bool closed() const;
  Stats stats() const;

 private:
  std::shared_ptr<Graph> graph_;
  std::weak_ptr<Scope> mount_;

  mutable std::mutex m_;
  std::map<uint32_t, std::function<void()>> pending_;
  bool scheduled_ = false;
  bool closed_ = false;
  Stats stats_;
};

template <class T>
Signal<T> signal(const std::shared_ptr<Graph>& graph, T initial, Equality<T> equals = SameValue{}) {
  graph->checkOwner();
  return Signal<T>(std::make_shared<detail::SignalNode<T>>(graph, std::move(initial), std::move(equals)));
}

template <class F, class T = std::decay_t<std::invoke_result_t<F&>>>
Computed<T> computed(const std::shared_ptr<Graph>& graph, F fn, Equality<T> equals = SameValue{}) {
  graph->checkOwner();
  return Computed<T>(std::make_shared<detail::ComputedNode<T>>(graph, std::function<T()>(std::move(fn)), std::move(equals)));
}

}  // namespace lucent::ui
