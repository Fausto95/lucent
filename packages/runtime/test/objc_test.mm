// Lucent runtime — Objective-C glue helpers (lucent/platform/ios.h) on the
// macOS host: blocks, the object cache, NSError out-parameters and sets, checked
// for what they keep alive (run.sh builds it with ARC, and ASan with SANITIZE=1).
#include <atomic>
#include <chrono>
#include <cstdio>
#include <memory>
#include <thread>

#include "lucent/lucent.h"
#include "lucent/platform/ios.h"

using namespace lucent;

/// Records whether it was deallocated on the main thread, as UIKit objects must be.
@interface LucentMainProbe : NSObject
@end

static std::atomic<int> probesDeallocated{0};
static std::atomic<int> probesDeallocatedOnMain{0};

@implementation LucentMainProbe
- (void)dealloc {
  if (onMainThread()) probesDeallocatedOnMain++;
  probesDeallocated++;
}
@end

static int checks = 0, failures = 0;
#define CHECK(cond)                                                                \
  do {                                                                             \
    checks++;                                                                      \
    if (!(cond)) {                                                                 \
      failures++;                                                                  \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                              \
  } while (0)

/// Blocks until the main thread has run what was posted to it before.
static bool mainCaughtUp() {
  auto done = std::make_shared<std::atomic<bool>>(false);
  postToMain([done] { *done = true; });

  for (int i = 0; i < 2000 && !*done; i++) std::this_thread::sleep_for(std::chrono::milliseconds(1));
  return *done;
}

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
    Actor::shared().waitIdle(2000);
    f = Fn<void(bool)>();
    now = nil;
    later = nil;
  }
  Actor::shared().waitIdle(2000);
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
  // The Out, released on the main thread, releases the error there.
  CHECK(mainCaughtUp());
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
  CHECK(mainCaughtUp());
  CHECK(liveNativeRefs() == before);
}

/// Objects a Lucent reference held are released on the main thread, where
/// UIKit requires it, whichever thread dropped the reference.
static void objectsAreReleasedOnMain() {
  @autoreleasepool {
    NativeRef probe = objc::wrap([LucentMainProbe new], "test");
    std::thread([moved = std::move(probe)]() mutable { moved = NativeRef(); }).join();
  }

  CHECK(mainCaughtUp());
  CHECK(probesDeallocated == 1 && probesDeallocatedOnMain == 1);
}

/// An optional Lucent function as an optional block (a block property
/// assigned null): absent gives nil, present a block that calls it.
static void optionalFunctionsBecomeOptionalBlocks() {
  @autoreleasepool {
    double seen = 0;
    auto make = [&](const auto& f) {
      return objc::block<void (^)(NSInteger)>([f_ = f](NSInteger n) { f_(static_cast<double>(n)); });
    };
    Opt<Fn<void(double)>> absent{null};
    Opt<Fn<void(double)>> present{Fn<void(double)>([&seen](double n) { seen = n; })};

    void (^none)(NSInteger) = objc::ifPresent(absent, make);
    void (^some)(NSInteger) = objc::ifPresent(present, make);
    CHECK(none == nil);
    CHECK(some != nil);

    some(3);
    CHECK(seen == 3);
  }
}

/// A 64-bit integer written through an Out reads back as a bigint, exactly
/// (NSIntegerMax too); a bigint goes in exactly, or throws RangeError when
/// the pointer's type cannot hold it. Other numbers stay numbers.
static void outIntegersAreBigInts() {
  @autoreleasepool {
    NativeRef out = objc::makeOut();
    objc::setOut(out, BigInt(42));
    { objc::NumberOut<NSInteger> p(out); *p.ptr() += 1; }
    CHECK(objc::outBigInt(out).get() == BigInt(43));

    { objc::NumberOut<NSInteger> p(out); *p.ptr() = NSIntegerMax; }
    CHECK(objc::outBigInt(out).get() == BigInt::fromInt64(NSIntegerMax));

    { objc::NumberOut<NSUInteger> p(out); *p.ptr() = NSUIntegerMax; }
    CHECK(objc::outBigInt(out).get() == BigInt::fromUint64(NSUIntegerMax));

    bool threw = false;
    objc::setOut(out, BigInt(-1));
    try {
      objc::NumberOut<NSUInteger> p(out);
    } catch (const Exception& e) {
      threw = e.error()->name.toUtf8() == "RangeError";
    }
    CHECK(threw);

    NativeRef number = objc::makeOut();
    objc::setOut(number, 1.5);
    { objc::NumberOut<double> p(number); *p.ptr() *= 2; }
    CHECK(objc::outNumber(number).get() == 3.0);
    CHECK(!objc::outBigInt(number).has());

    // A block's pointer: in and back out.
    NSInteger index = 7;
    NativeRef held = objc::outOf(&index);
    CHECK(objc::outBigInt(held).get() == BigInt(7));

    objc::setOut(held, BigInt(9));
    objc::writeOut(held, &index);
    CHECK(index == 9);
  }
}

/// NSSet ⇄ Lucent Set: every element once, whichever way; wrapped objects
/// stay themselves, so a set of them round-trips to the same NSObjects.
static void setsRoundTrip() {
  @autoreleasepool {
    NSSet* words = [NSSet setWithObjects:@"a", @"b", @"a", nil];
    Set<String> s = objc::fromNSSet<String>(words, [](id e) { return objc::fromNSString((NSString*)e, "test"); }, "test");
    CHECK(s.size() == 2);
    CHECK(s.has(String::fromLatin1("a")) && s.has(String::fromLatin1("b")));
    NSSet* back = objc::toNSSet(s, [](const String& e) -> id { return objc::toNSString(e); });
    CHECK([back isEqualToSet:words]);

    NSObject* o = [NSObject new];
    Set<NativeRef> refs = objc::fromNSSet<NativeRef>([NSSet setWithObject:o], [](id e) { return objc::wrap(e, "test"); }, "test");
    NSSet* objects = objc::toNSSet(refs, [](const NativeRef& e) -> id { return objc::unwrap(e); });
    CHECK(objects.count == 1 && objects.anyObject == o);
    CHECK(!objc::fromNSSetOpt<String>(nil, [](id e) { return objc::fromNSString((NSString*)e, "test"); }).has());
  }
}

int main() {
  blocksReleaseWhatTheyHold();
  cachedObjectsAreWeak();
  errorOutRetainsOnce();
  nativeReferencesAreCounted();
  objectsAreReleasedOnMain();
  setsRoundTrip();
  optionalFunctionsBecomeOptionalBlocks();
  outIntegersAreBigInts();
  std::printf("objc: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
