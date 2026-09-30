#include "resource.h"

#include <stdexcept>

#include "report.h"

namespace lucent {

std::shared_ptr<Resource> Resource::open(String what, std::function<void()> release, ExecutionContext* releaseOn,
                                         const std::shared_ptr<Scope>& scope) {
  if (!release) throw std::invalid_argument("A resource's release must be a function");

  std::shared_ptr<Resource> resource(new Resource(std::move(what), std::move(release), releaseOn));
  if (!scope) return resource;

  resource->scope_ = scope;
  std::weak_ptr<Resource> weak = resource;

  // Runs now, closing the resource, if the scope is no longer active. A
  // disposal on another thread may run it before the id is stored: the
  // stale id is then never removed, as the scope has taken its cleanups.
  Scope::CleanupId id = scope->onDispose([weak] {
    if (auto r = weak.lock()) r->close();
  });
  resource->cleanup_.store(id);

  return resource;
}

Resource::Resource(String what, std::function<void()> release, ExecutionContext* releaseOn)
    : what_(std::move(what)), releaseOn_(releaseOn), release_(std::move(release)) {}

Resource::~Resource() {
  // Nothing else refers to it now, so nothing can close it concurrently.
  if (state_.load(std::memory_order_acquire) != State::Open) return;

  state_.store(State::Closing, std::memory_order_release);
  unlink();

  try {
    detail::runOn(releaseOn_, std::move(release_));
  } catch (...) {
    reportUncaught(std::current_exception(), "resource");
  }
}

void Resource::check() const {
  if (isOpen()) return;

  throwError(String::fromLatin1("InvalidStateError"), what_ + String::fromLatin1(" is closed"));
}

bool Resource::close() {
  State expected = State::Open;
  if (!state_.compare_exchange_strong(expected, State::Closing, std::memory_order_acq_rel)) return false;

  unlink();

  // Closed once the release has run, wherever it runs, even if it throws.
  auto job = [self = weak_from_this(), release = std::move(release_)] {
    struct Closed {
      const std::weak_ptr<Resource>& self;

      ~Closed() {
        if (auto r = self.lock()) r->state_.store(State::Closed, std::memory_order_release);
      }
    } closed{self};

    release();
  };

  detail::runOn(releaseOn_, std::move(job));
  return true;
}

void Resource::unlink() {
  Scope::CleanupId id = cleanup_.exchange(0);
  if (id == 0) return;

  if (auto scope = scope_.lock()) scope->remove(id);
}

}  // namespace lucent
