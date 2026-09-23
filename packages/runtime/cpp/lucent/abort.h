// Lucent runtime — AbortController and AbortSignal.
//
// `aborted` may be read from any thread. Everything else, including abort
// itself, runs under the Lucent lock. A signal that came from JavaScript is
// aborted from the JS thread by a listener on the JS signal (lucent/jsi).
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <utility>
#include <vector>

#include "async.h"
#include "core.h"
#include "jserror.h"

namespace lucent {

class AbortSignalObject : public Object {
 public:
  std::atomic<bool> aborted{false};
  /// Set once, when the signal aborts.
  Error reason;

  /// Aborts once: records `why` and runs the listeners in the order they
  /// were added, synchronously, like dispatching the `abort` event.
  void abort(Error why);
  void throwIfAborted() const;
  /// `addEventListener("abort", f)`.
  void addEventListener(std::function<void()> f) { add(std::move(f)); }
  uint64_t add(std::function<void()> f);
  void remove(uint64_t id);

 private:
  uint64_t nextId_ = 1;
  std::vector<std::pair<uint64_t, std::function<void()>>> listeners_;
};
using AbortSignal = Ref<AbortSignalObject>;

struct AbortControllerObject : Object {
  AbortSignal signal = std::make_shared<AbortSignalObject>();
  /// `abort()` uses an AbortError, like React Native and the DOM.
  void abort(Opt<Error> reason);
};
using AbortController = Ref<AbortControllerObject>;

/// The default abort reason.
Error abortError();

/// `delay(ms, signal)`: rejects with the signal's reason if it aborts first.
Promise<void> delay(double ms, Opt<AbortSignal> signal);

}  // namespace lucent
