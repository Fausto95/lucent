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

/// What an object the OS made keeps while it lives: its Lucent instance's hold on module state.
@interface LucentOsKeep : NSObject
@end

@implementation LucentOsKeep {
 @public
  std::shared_ptr<void> keep_;
}
@end

namespace lucent::objc {

namespace {

char osKeepKey;

}  // namespace

bool adoptOsObject(id object, Class cls, std::shared_ptr<void> keep, const std::function<void()>& make, const char* what) {
  OsAdoption adoption{object, cls};
  OsAdoption* outer = osAdoption;
  osAdoption = &adoption;
  try {
    make();
  } catch (const std::exception& e) {
    osAdoption = outer;
    logError((std::string("[lucent] new ") + what + " for the OS threw " + e.what()).c_str());
    return false;
  } catch (...) {
    osAdoption = outer;
    logError((std::string("[lucent] new ") + what + " for the OS threw").c_str());
    return false;
  }
  osAdoption = outer;

  if (!adoption.adopted) {
    logError((std::string("[lucent] ") + what + ": its constructor made its object without super(…)").c_str());
    return false;
  }

  LucentOsKeep* k = [LucentOsKeep new];
  k->keep_ = std::move(keep);
  objc_setAssociatedObject(object, &osKeepKey, k, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return true;
}

}  // namespace lucent::objc

namespace lucent::entries {

// A native entry's platform objects (decision 0116): an object the caller still owns, retained;
// one given, kept until the caller is done with it.
NativeRef nativeIn(void* object) { return objc::wrap((__bridge id)object, "a native entry's argument"); }

void* nativeOut(Kept& k, const NativeRef& r) { return k.keep(r); }

}  // namespace lucent::entries
