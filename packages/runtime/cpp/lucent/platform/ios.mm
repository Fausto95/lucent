// Lucent runtime — iOS: the main queue.
#include "ios.h"

#import <dispatch/dispatch.h>

namespace lucent {

void postToMain(std::function<void()> job) {
  auto* heap = new std::function<void()>(std::move(job));
  dispatch_async_f(dispatch_get_main_queue(), heap, [](void* p) {
    std::unique_ptr<std::function<void()>> j(static_cast<std::function<void()>*>(p));
    (*j)();
  });
}

bool onMainThread() { return [NSThread isMainThread]; }

}  // namespace lucent
