#include "reactive.h"

#include <algorithm>

#include "report.h"
#include "trace.h"

namespace lucent::ui {

namespace detail {

namespace {

void unsubscribe(Node& source, Observer* observer) {
  auto& list = source.observers_;
  list.erase(std::remove(list.begin(), list.end(), observer), list.end());
}

}  // namespace

bool Observer::Edges::has(const Node* node) const {
  if (list_.size() <= kLinear)
    return std::any_of(list_.begin(), list_.end(), [node](const Edge& e) { return e.source.get() == node; });

  return index_.count(node) > 0;
}

void Observer::Edges::add(Edge edge) {
  list_.push_back(std::move(edge));
  if (list_.size() <= kLinear) return;

  if (index_.empty())
    for (auto& e : list_) index_.insert(e.source.get());
  else
    index_.insert(list_.back().source.get());
}

void Observer::Edges::clear() {
  list_.clear();
  index_.clear();
}

Observer::~Observer() { unlinkAll(); }

bool Observer::stale() {
  if (fresh_) return true;

  for (auto& e : sources_) {
    e.source->refresh();
    if (e.source->version_ != e.version) return true;
  }

  return false;
}

void Observer::track(Node& source) {
  if (next_.has(&source)) return;

  next_.add({source.shared_from_this(), source.version_});

  // Subscribed at once, so a write later in this run reaches it.
  if (!sources_.has(&source)) source.observers_.push_back(this);
}

void Observer::finish() {
  for (auto& e : sources_)
    if (!next_.has(e.source.get())) unsubscribe(*e.source, this);

  sources_ = std::move(next_);
  next_.clear();
}

void Observer::unlinkAll() {
  for (auto& e : sources_) unsubscribe(*e.source, this);
  for (auto& e : next_) unsubscribe(*e.source, this);

  sources_.clear();
  next_.clear();
}

}  // namespace detail

std::shared_ptr<Graph> Graph::create(ExecutionContext& owner, GraphOptions options) {
  return std::make_shared<Graph>(Token{}, owner, std::move(options));
}

Graph::Graph(Token, ExecutionContext& owner, GraphOptions options) : owner_(owner), options_(std::move(options)) {
  // A context made by make_shared owns the scopes (their disposal runs there).
  ownerRef_ = std::weak_ptr<Scope::Owner>(owner.weak_from_this().lock());
  root_ = Scope::createRoot(0, ownerRef_);
  scope_ = root_;
}

void Graph::checkOwner() const {
  if (!owner_.isCurrent()) throw std::logic_error("A UI reactive graph is used only on the context that owns it");
}

void Graph::checkWritable() const {
  if (computing_ > 0) throwError(String::fromLatin1("InvalidStateError"), String::fromLatin1("A computed value cannot write a signal"));
}

void Graph::onCleanup(std::function<void()> cleanup) {
  checkOwner();
  scope_->onDispose(std::move(cleanup));
}

void Graph::dispose() {
  checkOwner();
  Batch batch(*this);
  Tracking none(*this, nullptr);

  report(root_->dispose(), "effect cleanup");
}

void Graph::read(detail::Node& node) {
  if (tracker_) tracker_->track(node);
}

void Graph::changed(detail::Node& node) {
  node.version_++;

  epoch_++;
  mark(node);

  if (batch_ == 0) flushPending();
}

void Graph::mark(detail::Node& node) {
  // By index: the list does not change while marking, but stays valid if it did.
  for (size_t i = 0; i < node.observers_.size(); i++) {
    detail::Observer* o = node.observers_[i];
    if (o->mark_ == epoch_) continue;

    o->mark_ = epoch_;
    o->maybeStale_ = true;

    if (o->effect_)
      enqueue(static_cast<detail::EffectNode&>(*o));
    else
      mark(*o);
  }
}

void Graph::enqueue(detail::EffectNode& effect) {
  if (effect.queued_ || effect.disposed_) return;

  effect.queued_ = true;
  effect.cause_ = running_ ? std::static_pointer_cast<detail::EffectNode>(running_->shared_from_this()) : nullptr;
  queue_[effect.order_] = std::static_pointer_cast<detail::EffectNode>(effect.shared_from_this());
}

void Graph::flushPending() {
  if (flushing_ || queue_.empty()) return;

  struct Updating {
    explicit Updating(Graph& g) : g(g) {
      g.flushing_ = true;
      g.batch_++;
      g.updates_++;
    }
    ~Updating() {
      g.batch_--;
      g.flushing_ = false;
    }
    Graph& g;
  } updating(*this);

  while (!queue_.empty()) {
    auto effect = queue_.begin()->second;
    queue_.erase(queue_.begin());
    effect->queued_ = false;

    if (effect->disposed_) continue;

    if (!effect->stale()) {
      effect->maybeStale_ = false;
      continue;
    }

    if (effect->update_ == updates_ && effect->runs_ >= options_.loopLimit) {
      loop(*effect);

      // The rest wait for their next change.
      for (auto& [order, pending] : queue_) pending->queued_ = false;
      queue_.clear();
      break;
    }

    runEffect(*effect);
  }
}

void Graph::runEffect(detail::EffectNode& e) {
  auto keep = e.shared_from_this();
  Batch batch(*this);

  struct Running {
    Running(Graph& g, detail::EffectNode* e) : g(g), outer(g.running_) { g.running_ = e; }
    ~Running() { g.running_ = outer; }
    Graph& g;
    detail::EffectNode* outer;
  } running(*this, &e);

  if (e.run_) {
    Tracking none(*this, nullptr);
    report(e.run_->dispose(), "effect cleanup");
  }

  if (e.disposed_) return;

  e.run_ = Scope::createRoot(e.runtime_, ownerRef_);
  e.fresh_ = false;
  e.maybeStale_ = false;

  if (flushing_) {
    if (e.update_ != updates_) {
      e.update_ = updates_;
      e.runs_ = 0;
    }
    e.runs_++;
  }

  e.begin();
  {
    Tracking tracking(*this, &e);
    ScopeSwap swap(*this, e.run_);

    // A span per run, at the effect's source line: one relaxed load when tracing is off.
    trace::Scope span(trace::Category::Effect, "effect", e.site_);

    try {
      e.fn_();
    } catch (...) {
      report(std::current_exception(), "effect");
    }
  }

  if (e.disposed_)
    e.unlinkAll();
  else
    e.finish();
}

void Graph::disposeEffect(detail::EffectNode& e) {
  if (e.disposed_) return;

  auto keep = e.shared_from_this();
  e.disposed_ = true;

  if (auto owner = e.owner_.lock()) owner->remove(e.registration_);
  e.unlinkAll();

  Batch batch(*this);
  if (e.run_) {
    Tracking none(*this, nullptr);
    report(e.run_->dispose(), "effect cleanup");
  }
}

void Graph::loop(detail::EffectNode& e) {
  // Back from `e` through the effects that made each pending, to the first repeat.
  std::vector<std::shared_ptr<detail::EffectNode>> chain;
  auto x = std::static_pointer_cast<detail::EffectNode>(e.shared_from_this());

  while (x && std::find(chain.begin(), chain.end(), x) == chain.end()) {
    chain.push_back(x);
    x = x->cause_.lock();
  }

  std::string names = x ? x->name_ : "";
  for (auto it = chain.rbegin(); it != chain.rend(); ++it) names += (names.empty() ? "" : " -> ") + (*it)->name_;

  std::string message = "Effects kept rerunning: " + names + " (" + e.name_ + " ran " + std::to_string(options_.loopLimit) +
                        " times in one update)";

  report(std::make_exception_ptr(Exception(makeError(String::fromLatin1("RangeError"), String::fromUtf8(message)))), "effect loop");
}

void Graph::report(std::exception_ptr error, const char* where) {
  if (!error) return;

  try {
    if (options_.onError)
      options_.onError(error, where);
    else
      reportUncaught(error, where);
  } catch (...) {
    reportUncaught(std::current_exception(), "a UI reactive graph's error handler");
  }
}

Effect effect(const std::shared_ptr<Graph>& graph, std::function<void()> fn, std::string name,
              const trace::Site* site) {
  Graph& g = *graph;
  g.checkOwner();

  auto node = std::make_shared<detail::EffectNode>(graph, std::move(fn), std::move(name), ++g.made_, site);
  const std::shared_ptr<Scope>& scope = g.scope_;

  if (scope->state() != Scope::State::Active) {
    node->disposed_ = true;
    return Effect(node);
  }

  node->runtime_ = scope->runtime();
  node->owner_ = scope;
  node->registration_ = scope->onDispose([node] { node->graph_->disposeEffect(*node); });

  // 0: the scope stopped taking cleanups, and ran this one at once.
  if (node->registration_ == 0) return Effect(node);

  g.runEffect(*node);
  return Effect(node);
}

void Effect::dispose() const {
  if (!node_) return;

  Graph& g = *node_->graph_;
  g.checkOwner();
  g.disposeEffect(*node_);
}

std::shared_ptr<PropInbox> PropInbox::create(std::shared_ptr<Graph> graph, const std::shared_ptr<Scope>& mount) {
  graph->checkOwner();

  auto inbox = std::make_shared<PropInbox>(Token{}, std::move(graph), mount);
  std::weak_ptr<PropInbox> weak = inbox;

  // Run at once, closing it, if the mount is already gone.
  mount->onDispose([weak] {
    if (auto self = weak.lock()) self->close();
  });

  return inbox;
}

PropInbox::PropInbox(Token, std::shared_ptr<Graph> graph, const std::shared_ptr<Scope>& mount)
    : graph_(std::move(graph)), mount_(mount) {}

bool PropInbox::post(Commit commit) {
  bool schedule;
  {
    std::lock_guard<std::mutex> g(m_);
    if (closed_) return false;

    for (auto& change : commit) pending_[change.field] = std::move(change.write);
    stats_.commits++;

    schedule = !scheduled_;
    scheduled_ = true;
  }

  if (!schedule) return true;

  // Owned by the mount: dropped if it is disposed first.
  auto mount = mount_.lock();
  std::weak_ptr<PropInbox> weak = weak_from_this();
  bool posted = mount && graph_->owner().post(
                             [weak] {
                               if (auto self = weak.lock()) self->drain();
                             },
                             mount);

  if (!posted) {
    std::lock_guard<std::mutex> g(m_);
    scheduled_ = false;
  }

  return true;
}

bool PropInbox::drain() {
  graph_->checkOwner();

  std::map<uint32_t, std::function<void()>> commit;
  {
    std::lock_guard<std::mutex> g(m_);
    commit.swap(pending_);
    scheduled_ = false;

    if (commit.empty()) return false;
    stats_.applied++;
  }

  graph_->transaction([&] {
    for (auto& [field, write] : commit) write();
  });

  return true;
}

void PropInbox::close() {
  std::map<uint32_t, std::function<void()>> dropped;

  std::lock_guard<std::mutex> g(m_);
  closed_ = true;
  dropped.swap(pending_);
}

bool PropInbox::closed() const {
  std::lock_guard<std::mutex> g(m_);
  return closed_;
}

PropInbox::Stats PropInbox::stats() const {
  std::lock_guard<std::mutex> g(m_);
  return stats_;
}

}  // namespace lucent::ui
