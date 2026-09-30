#include "abort.h"

#include <exception>
#include <memory>

#include "report.h"
#include "scheduler.h"

namespace lucent {

namespace {

/// Like an event listener: what it throws is reported, and the rest run.
void runListener(const std::function<void()>& f) {
  try {
    f();
  } catch (...) {
    reportUncaught(std::current_exception(), "abort listener");
  }
}

}  // namespace

bool AbortSignalObject::onOwner() const {
  return owner_ ? owner_->isCurrent() : Scheduler::lock().heldByCurrentThread();
}

void AbortSignalObject::toOwner(std::function<void(AbortSignalObject&)> change) {
  auto self = std::static_pointer_cast<AbortSignalObject>(shared_from_this());

  ExecutionContext::of(owner_).post([self, change = std::move(change)] { change(*self); });
}

void AbortSignalObject::abort(Error why) {
  if (!onOwner()) {
    toOwner([why = std::move(why)](AbortSignalObject& s) { s.abort(why); });
    return;
  }

  if (aborted.load()) return;

  reason = std::move(why);
  aborted.store(true);

  auto listeners = std::move(listeners_);
  listeners_.clear();

  for (auto& [id, f] : listeners) runListener(f);
}

void AbortSignalObject::throwIfAborted() const {
  if (aborted.load()) throw Exception(reason);
}

uint64_t AbortSignalObject::add(std::function<void()> f) {
  if (onOwner()) {
    if (aborted.load()) return 0;

    uint64_t id = nextId_++;
    listeners_.emplace_back(id, std::move(f));
    return id;
  }

  uint64_t id = nextId_++;
  toOwner([id, f = std::move(f)](AbortSignalObject& s) mutable { s.join(id, std::move(f)); });
  return id;
}

void AbortSignalObject::join(uint64_t id, std::function<void()> f) {
  // Added before this context could see the abort: it happened first.
  if (aborted.load()) {
    runListener(f);
    return;
  }

  listeners_.emplace_back(id, std::move(f));
}

void AbortSignalObject::remove(uint64_t id) {
  if (!onOwner()) {
    toOwner([id](AbortSignalObject& s) { s.remove(id); });
    return;
  }

  std::erase_if(listeners_, [id](const auto& l) { return l.first == id; });
}

void AbortControllerObject::abort(Opt<Error> why) {
  signal->abort(why.has() ? why.get() : abortError());
}

Error abortError() {
  return makeError(String::fromLatin1("AbortError"), String::fromLatin1("signal is aborted without reason"));
}

Promise<void> delay(double ms, Opt<AbortSignal> signal) {
  if (!signal.has()) return delay(ms);
  AbortSignal s = signal.get();
  if (s->aborted.load()) return Promise<void>::rejected(s->reason);
  Promise<void> p;
  uint64_t id = s->add([p, s] { p.reject(s->reason); });
  ExecutionContext::of(ExecutionContext::currentRef()).postDelayed(ms, [p, s, id] {
    s->remove(id);
    p.resolve(undefined);
  });
  return p;
}

}  // namespace lucent
