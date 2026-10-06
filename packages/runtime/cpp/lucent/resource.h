// Lucent runtime — resources: what Lucent code opens and must close once.
//
// A Resource holds the release of something native (a camera session, a
// file, a subscription). It is open until it closes, closing while its
// release runs, then closed. It closes at the first of an explicit
// close(), the disposal of the scope it belongs to, or its last reference
// going: finalization is a backstop, never the only way. Its release runs
// exactly once, on the context the resource requires.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>

#include "execution.h"
#include "jserror.h"
#include "jsstring.h"
#include "scope.h"

namespace lucent {

class Resource : public std::enable_shared_from_this<Resource> {
 public:
  enum class State : uint8_t { Open, Closing, Closed };

  /// Opens a resource named `what` in its errors ("Camera is closed").
  /// `release` runs once, when it closes: on `releaseOn`'s thread if given
  /// (posted there from any other), else wherever it closes. With a
  /// `scope`, disposing the scope closes the resource; the scope refers to
  /// it weakly, so it never keeps the resource alive. Under a scope that is
  /// no longer active, the resource is closed at once.
  static std::shared_ptr<Resource> open(String what, std::function<void()> release, ExecutionContext* releaseOn = nullptr,
                                        const std::shared_ptr<Scope>& scope = nullptr);

  /// Closes it if still open (the backstop). An error from its release is
  /// reported (reportUncaught).
  ~Resource();

  Resource(const Resource&) = delete;
  Resource& operator=(const Resource&) = delete;

  State state() const { return state_.load(std::memory_order_acquire); }

  bool isOpen() const { return state() == State::Open; }

  /// What every ordinary use checks first: throws InvalidStateError
  /// "<what> is closed" unless the resource is open.
  void check() const;

  /// Any thread, idempotent. The first call closes the resource and
  /// returns true; any other returns false at once, without waiting for a
  /// release in progress. The resource is closed once its release has run,
  /// even if the release throws: run here, its error reaches the caller;
  /// posted, it is reported.
  bool close();

 private:
  Resource(String what, std::function<void()> release, ExecutionContext* releaseOn);

  /// Forgets the scope's cleanup, if it has not run.
  void unlink();

  const String what_;
  ExecutionContext* const releaseOn_;

  /// Taken by whichever closes the resource first.
  std::function<void()> release_;
  std::atomic<State> state_{State::Open};

  std::weak_ptr<Scope> scope_;
  std::atomic<Scope::CleanupId> cleanup_{0};
  [[no_unique_address]] live::Counted<live::Kind::Resource> counted_;
};

}  // namespace lucent
