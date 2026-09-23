// Lucent runtime — Objective-C glue helpers (lucent/platform/ios.h) on the
// macOS host: blocks, the object cache and NSError out-parameters, checked
// for what they keep alive (run.sh builds it with ARC, and ASan with SANITIZE=1).
#include <cstdio>
#include <memory>
#include <thread>

#include "lucent/lucent.h"
#include "lucent/platform/ios.h"

namespace lucent::objc {
// On iOS, ios.mm releases UIKit objects on the main thread; here, at once.
void releaseOnMain(void* retained) { CFRelease(retained); }
}  // namespace lucent::objc

using namespace lucent;

static int checks = 0, failures = 0;
#define CHECK(cond)                                                                \
  do {                                                                             \
    checks++;                                                                      \
    if (!(cond)) {                                                                 \
      failures++;                                                                  \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                              \
  } while (0)

/// A block made from a Lucent function releases the function (and what it
/// captured) when the block goes; called in place or queued from another thread.
static void blocksReleaseWhatTheyHold() {
  auto captured = std::make_shared<int>(1);
  std::weak_ptr<int> watch = captured;
  int calls = 0;
  @autoreleasepool {
    Fn<void(bool)> f([captured = std::move(captured), &calls](bool) { calls++; });
    void (^now)(BOOL) = objc::block<void (^)(BOOL)>([f_ = f](BOOL a) { callNow([&]() { f_(a == YES); }); });
    void (^later)(BOOL) = objc::block<void (^)(BOOL)>([f_ = f](BOOL a) { postCallback([f_, a]() { f_(a == YES); }); });
    now(YES);
    std::thread([later] { later(NO); }).join();
    Scheduler::instance().waitIdle(2000);
    f = Fn<void(bool)>();
    now = nil;
    later = nil;
  }
  Scheduler::instance().waitIdle(2000);
  CHECK(calls == 2);
  CHECK(watch.expired());
}

/// One Objective-C object per Lucent object while it is alive, held weakly.
static void cachedObjectsAreWeak() {
  int key = 0;
  __weak id weak = nil;
  @autoreleasepool {
    id first = objc::cachedObject(&key, ^id { return [NSObject new]; });
    id again = objc::cachedObject(&key, ^id { return [NSObject new]; });
    CHECK(first == again);
    weak = first;
  }
  CHECK(weak == nil);
}

/// An NSError** argument's error is retained once by its Out, and read back.
static void errorOutRetainsOnce() {
  __weak NSError* weak = nil;
  @autoreleasepool {
    NativeRef out = objc::makeOut();
    {
      objc::ErrorOut slot(out);
      *slot.ptr() = [NSError errorWithDomain:@"LucentTest" code:7 userInfo:nil];
    }
    Opt<Error> e = objc::outError(out);
    CHECK(e.has() && e.get()->code.has() && e.get()->code.get() == String::fromLatin1("LucentTest:7"));
    weak = (__bridge NSError*)static_cast<objc::OutSlot*>(out.get())->value;
    CHECK(weak != nil);
  }
  CHECK(weak == nil);
}

/// Lucent code knows how many native references it holds (the teardown report).
static void nativeReferencesAreCounted() {
  long before = liveNativeRefs();
  @autoreleasepool {
    NativeRef a = objc::wrap([NSObject new], "test");
    NativeRef b = a;
    CHECK(liveNativeRefs() == before + 1);
  }
  CHECK(liveNativeRefs() == before);
}

int main() {
  blocksReleaseWhatTheyHold();
  cachedObjectsAreWeak();
  errorOutRetainsOnce();
  nativeReferencesAreCounted();
  std::printf("objc: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
