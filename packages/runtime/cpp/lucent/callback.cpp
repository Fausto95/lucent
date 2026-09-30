#include "callback.h"

namespace lucent {

std::function<void()> detail::followSignal(const AbortSignal& signal, std::function<void(Error)> cancel) {
  std::weak_ptr<AbortSignalObject> weak = signal;

  uint64_t id = signal->add([weak, cancel] {
    if (auto s = weak.lock()) cancel(s->reason);
  });

  // Refused on the signal's context: it has aborted since it was checked.
  if (id == 0) {
    cancel(signal->reason);
    return [] {};
  }

  return [weak, id] {
    if (auto s = weak.lock()) s->remove(id);
  };
}

Opt<Error> detail::abortedBy(const Opt<AbortSignal>& signal) {
  if (!signal.has() || !signal.get() || !signal.get()->aborted.load()) return undefined;

  return signal.get()->reason;
}

}  // namespace lucent
