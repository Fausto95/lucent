// Lucent runtime — iOS: the main queue.
#include "ios.h"
#include "../entries.h"

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

namespace lucent::entries {

// A native entry's platform objects (decision 0116): an object the caller still owns, retained;
// one given, kept until the caller is done with it.
NativeRef nativeIn(void* object) { return objc::wrap((__bridge id)object, "a native entry's argument"); }

void* nativeOut(Kept& k, const NativeRef& r) { return k.keep(r); }

}  // namespace lucent::entries
