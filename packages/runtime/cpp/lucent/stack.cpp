#include "stack.h"

#include <pthread.h>

#include <cstdint>

namespace lucent {

namespace {

/// The lowest usable address of the calling thread's stack, or 0 if the
/// platform does not say.
uintptr_t findLimit() {
#if defined(__APPLE__)
  pthread_t self = pthread_self();
  auto top = reinterpret_cast<uintptr_t>(pthread_get_stackaddr_np(self));
  size_t size = pthread_get_stacksize_np(self);
  return top > size ? top - size : 0;
#elif defined(__linux__) || defined(__ANDROID__)
  pthread_attr_t attr;
  if (pthread_getattr_np(pthread_self(), &attr) != 0) return 0;

  void* low = nullptr;
  size_t size = 0;
  uintptr_t limit = pthread_attr_getstack(&attr, &low, &size) == 0 ? reinterpret_cast<uintptr_t>(low) : 0;
  size_t guard = 0;
  if (pthread_attr_getguardsize(&attr, &guard) == 0 && limit) limit += guard;
  pthread_attr_destroy(&attr);
  return limit;
#else
  return 0;
#endif
}

struct Bounds {
  uintptr_t limit = 0;
  /// The margin, at most a quarter of the stack (a small thread's).
  size_t margin = kStackMargin;
  bool known = false;
};

thread_local Bounds bounds;

}  // namespace

bool stackExhausted(size_t need) {
  Bounds& b = bounds;
  if (!b.known) {
    b.limit = findLimit();
    b.known = true;

    // The frame asking first is near the stack's top.
    char here;
    auto at = reinterpret_cast<uintptr_t>(&here);
    if (b.limit && at > b.limit && (at - b.limit) / 4 < b.margin) b.margin = (at - b.limit) / 4;
  }

  if (!b.limit) return false;

  char here;
  auto at = reinterpret_cast<uintptr_t>(&here);
  return at < b.limit + b.margin + need;
}

}  // namespace lucent
