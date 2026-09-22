#include "abort.h"

#include <cstdio>
#include <exception>

#include "scheduler.h"

namespace lucent {

void AbortSignalObject::abort(Error why) {
  if (aborted.load()) return;
  reason = std::move(why);
  aborted.store(true);
  auto listeners = std::move(listeners_);
  listeners_.clear();
  for (auto& [id, f] : listeners) {
    // Like an event listener: a throwing listener does not stop the others.
    try {
      f();
    } catch (const std::exception& e) {
      std::fprintf(stderr, "[lucent] uncaught exception in abort listener: %s\n", e.what());
    }
  }
}

void AbortSignalObject::throwIfAborted() const {
  if (aborted.load()) throw Exception(reason);
}

uint64_t AbortSignalObject::add(std::function<void()> f) {
  uint64_t id = nextId_++;
  if (!aborted.load()) listeners_.emplace_back(id, std::move(f));
  return id;
}

void AbortSignalObject::remove(uint64_t id) {
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
  Scheduler::instance().postDelayed(ms, [p, s, id] {
    s->remove(id);
    p.resolve(undefined);
  });
  return p;
}

}  // namespace lucent
