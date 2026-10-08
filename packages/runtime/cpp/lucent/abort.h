// Lucent runtime — AbortController and AbortSignal.
//
// A signal belongs to the execution context it was made in. Any thread may
// read `aborted` (then `reason`), abort it, or add and remove listeners;
// from another context, abort and listener changes are posted to the owner,
// where the listeners run. A signal that came from JavaScript is aborted
// from the JS thread, in the actor of the call it was passed to, by a listener on the JS
// signal (lucent/jsi).
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
  /// Set once, when the signal aborts, before `aborted`.
  Error reason;

  /// Aborts once: records `why` and runs the listeners in the order they
  /// were added, synchronously on the owner, like dispatching the `abort`
  /// event. From another context, posted there. A listener's error is
  /// reported and the others still run.
  void abort(Error why);
  void throwIfAborted() const;
  /// `addEventListener("abort", f)`.
  void addEventListener(std::function<void()> f) { add(std::move(f)); }
  /// On the owner: 0, and `f` dropped, if the signal has aborted (it would
  /// never run). From another context, `f` joins on the owner, and runs
  /// there at once if the signal aborted before it arrived.
  uint64_t add(std::function<void()> f);
  void remove(uint64_t id);

 private:
  bool onOwner() const;
  void toOwner(std::function<void(AbortSignalObject&)> change);
  void join(uint64_t id, std::function<void()> f);

  const ContextRef owner_ = ExecutionContext::currentRef();
  std::atomic<uint64_t> nextId_{1};
  std::vector<std::pair<uint64_t, std::function<void()>>> listeners_;
};
using AbortSignal = Ref<AbortSignalObject>;

struct AbortControllerObject : Object {
  AbortSignal signal = std::make_shared<AbortSignalObject>();
  /// `abort()` uses an AbortError, like React Native and the DOM.
  void abort(Opt<Error> reason);
};
using AbortController = Ref<AbortControllerObject>;

inline String toJsString(const AbortSignal&) { return String::fromLatin1("[object AbortSignal]"); }
inline String toJsString(const AbortController&) { return String::fromLatin1("[object AbortController]"); }

/// The default abort reason.
Error abortError();

/// `delay(ms, signal)`: rejects with the signal's reason if it aborts first.
Promise<void> delay(double ms, Opt<AbortSignal> signal);

}  // namespace lucent
