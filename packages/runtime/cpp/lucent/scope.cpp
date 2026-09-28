#include "scope.h"

#include "report.h"

namespace lucent {

namespace {
// Constant-initialized: safe to use during static initialization.
std::atomic<ScopeId> nextScopeId{1};
std::atomic<OperationId> nextOperationId{1};
}  // namespace

Error scopeDisposedError() {
  return makeError(String::fromLatin1("AbortError"), String::fromLatin1("The operation's scope was disposed"));
}

std::exception_ptr detail::aggregateErrors(std::exception_ptr pending, std::exception_ptr next) {
  if (!next) return pending;
  if (!pending) return next;
  return suppressedError(next, pending);
}

// --- OperationBase ------------------------------------------------------------

void detail::OperationBase::setCleanup(std::function<void()> cleanup) {
  std::function<void()> removed;

  {
    std::lock_guard<std::mutex> g(m_);

    if (!cleanup) {
      // Destroyed after unlocking: what it captured may call back in.
      removed = std::exchange(cleanup_, nullptr);
      return;
    }

    if (cleanup_) throw std::logic_error("The operation already has a cleanup");

    if (state_.load(std::memory_order_relaxed) == OperationState::Pending) {
      cleanup_ = std::move(cleanup);
      return;
    }
  }

  // Settled already: the registration completed before it returned.
  try {
    cleanup();
  } catch (...) {
    report(std::current_exception());
  }
}

bool detail::OperationBase::attach(const std::shared_ptr<Scope>& scope, bool pending) {
  return scope->adopt(shared_from_this(), pending);
}

void detail::OperationBase::detach() {
  if (auto scope = scope_.lock()) scope->forget(token_.operation);
}

std::exception_ptr detail::OperationBase::runCleanup() {
  std::function<void()> cleanup;

  {
    std::lock_guard<std::mutex> g(m_);

    if (state_.load(std::memory_order_relaxed) == OperationState::Pending) return nullptr;

    cleanup = std::exchange(cleanup_, nullptr);
  }

  if (!cleanup) return nullptr;

  try {
    cleanup();
  } catch (...) {
    return std::current_exception();
  }

  return nullptr;
}

void detail::OperationBase::report(std::exception_ptr e) {
  if (e) reportUncaught(e, "operation");
}

// --- Scope ---------------------------------------------------------------

Scope::Scope(RuntimeId runtime, const std::shared_ptr<Scope>& parent, std::weak_ptr<Owner> owner)
    : runtime_(runtime),
      id_(nextScopeId.fetch_add(1, std::memory_order_relaxed)),
      parent_(parent),
      owner_(std::move(owner)) {}

std::shared_ptr<Scope> Scope::create(RuntimeId runtime, const std::shared_ptr<Scope>& parent) {
  if (parent && parent->runtime_ != 0 && parent->runtime_ != runtime) {
    throw std::invalid_argument("A child scope belongs to its parent's runtime");
  }

  std::shared_ptr<Scope> scope(new Scope(runtime, parent, parent ? parent->owner_ : std::weak_ptr<Owner>()));

  // Nothing is registered yet: disposed here, whatever the owner.
  if (parent && !parent->adoptChild(scope)) scope->disposeHere();

  return scope;
}

std::shared_ptr<Scope> Scope::createRoot(RuntimeId runtime, std::weak_ptr<Owner> owner) {
  return std::shared_ptr<Scope>(new Scope(runtime, nullptr, std::move(owner)));
}

Scope::~Scope() {
  if (auto e = dispose()) reportUncaught(e, "scope");
}

Scope::CleanupId Scope::onDispose(std::function<void()> cleanup) {
  if (!cleanup) throw std::invalid_argument("A scope cleanup must be a function");

  {
    std::lock_guard<std::mutex> g(m_);

    if (state_.load(std::memory_order_relaxed) == State::Active) {
      CleanupId id = nextCleanup_++;
      cleanups_.emplace(id, std::move(cleanup));
      return id;
    }
  }

  cleanup();
  return 0;
}

bool Scope::remove(CleanupId id) {
  std::function<void()> removed;

  {
    std::lock_guard<std::mutex> g(m_);

    auto it = cleanups_.find(id);
    if (it == cleanups_.end()) return false;

    // Destroyed after unlocking: what it captured may call back in.
    removed = std::move(it->second);
    cleanups_.erase(it);
  }

  return true;
}

std::exception_ptr Scope::dispose() {
  if (state_.load(std::memory_order_acquire) != State::Active) return nullptr;

  auto owner = owner_.lock();
  if (!owner || owner->isCurrent()) return disposeHere();

  if (auto self = weak_from_this().lock()) {
    auto job = [self] {
      if (auto e = self->dispose()) reportUncaught(e, "scope");
    };

    if (owner->post(std::move(job))) return nullptr;

    return disposeHere();
  }

  // The destructor: nothing refers to this scope any more, so its teardown
  // goes to the owner alone.
  auto teardown = begin();
  if (!teardown) return nullptr;

  auto moved = std::make_shared<Teardown>(std::move(*teardown));
  auto job = [moved] {
    if (auto e = finish(*moved)) reportUncaught(e, "scope");
  };

  if (owner->post(std::move(job))) return nullptr;

  return finish(*moved);
}

std::exception_ptr Scope::disposeHere() {
  // A child's last reference may be its parent's, dropped below. Null in
  // the destructor, where nothing else refers to this scope.
  auto self = weak_from_this().lock();

  auto teardown = begin();
  if (!teardown) return nullptr;

  std::exception_ptr errors = finish(*teardown);

  state_.store(State::Disposed, std::memory_order_release);

  if (auto parent = parent_.lock()) parent->forgetChild(id_);

  return errors;
}

std::optional<Scope::Teardown> Scope::begin() {
  std::lock_guard<std::mutex> g(m_);

  if (state_.load(std::memory_order_relaxed) != State::Active) return std::nullopt;

  generation_.fetch_add(1, std::memory_order_acq_rel);
  state_.store(State::Disposing, std::memory_order_release);

  Teardown teardown;
  teardown.children.swap(children_);
  teardown.operations.swap(operations_);
  teardown.cleanups.swap(cleanups_);
  return teardown;
}

std::exception_ptr Scope::finish(Teardown& teardown) {
  std::exception_ptr errors;

  for (auto it = teardown.children.rbegin(); it != teardown.children.rend(); ++it) {
    errors = detail::aggregateErrors(errors, it->second->dispose());
  }

  if (!teardown.operations.empty()) {
    Error reason = scopeDisposedError();

    for (auto it = teardown.operations.rbegin(); it != teardown.operations.rend(); ++it) {
      errors = detail::aggregateErrors(errors, it->second->cancelOwned(reason));
    }

    for (auto it = teardown.operations.rbegin(); it != teardown.operations.rend(); ++it) {
      errors = detail::aggregateErrors(errors, it->second->runCleanup());
    }
  }

  for (auto it = teardown.cleanups.rbegin(); it != teardown.cleanups.rend(); ++it) {
    try {
      it->second();
    } catch (...) {
      errors = detail::aggregateErrors(errors, std::current_exception());
    }
  }

  return errors;
}

bool Scope::validates(const OperationToken& token) const {
  std::lock_guard<std::mutex> g(m_);

  if (state_.load(std::memory_order_relaxed) != State::Active) return false;
  if (token.runtime != runtime_ || token.scope != id_) return false;
  if (token.generation != generation_.load(std::memory_order_relaxed)) return false;

  auto it = operations_.find(token.operation);
  return it != operations_.end() && it->second->state() == OperationState::Pending;
}

size_t Scope::registrations() const {
  std::lock_guard<std::mutex> g(m_);

  return children_.size() + operations_.size() + cleanups_.size();
}

bool Scope::adopt(const std::shared_ptr<detail::OperationBase>& op, bool pending) {
  std::lock_guard<std::mutex> g(m_);

  // Under the lock, so the generation and the state agree, and ids follow
  // the order operations join the scope.
  op->token_ = {runtime_, id_, generation_.load(std::memory_order_relaxed),
                nextOperationId.fetch_add(1, std::memory_order_relaxed)};
  op->scope_ = weak_from_this();

  if (!pending || state_.load(std::memory_order_relaxed) != State::Active) return false;

  operations_.emplace(op->token_.operation, op);
  return true;
}

void Scope::forget(OperationId id) {
  // Released after unlocking.
  std::shared_ptr<detail::OperationBase> op;
  std::lock_guard<std::mutex> g(m_);

  auto it = operations_.find(id);
  if (it == operations_.end()) return;

  op = std::move(it->second);
  operations_.erase(it);
}

bool Scope::adoptChild(const std::shared_ptr<Scope>& child) {
  std::lock_guard<std::mutex> g(m_);

  if (state_.load(std::memory_order_relaxed) != State::Active) return false;

  children_.emplace(child->id_, child);
  return true;
}

void Scope::forgetChild(ScopeId id) {
  // Released after unlocking.
  std::shared_ptr<Scope> child;
  std::lock_guard<std::mutex> g(m_);

  auto it = children_.find(id);
  if (it == children_.end()) return;

  child = std::move(it->second);
  children_.erase(it);
}

}  // namespace lucent
