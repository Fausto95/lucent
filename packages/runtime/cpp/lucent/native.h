// Lucent runtime — platform objects and the main thread.
//
// A NativeRef holds an Objective-C object (retained) or a JNI global
// reference. It is opaque here, so generated headers stay plain C++; the
// glue in *.ios.lucent.ts (.mm) and *.android.lucent.ts units wraps and
// unwraps it (lucent/platform/ios.h, lucent/platform/android.h).
#pragma once

#include <functional>
#include <memory>
#include <type_traits>

#include "async.h"
#include "jserror.h"
#include "scheduler.h"

namespace lucent {

class NativeRef {
 public:
  NativeRef() = default;
  /// Takes ownership of `handle`; `release` runs when the last copy goes.
  NativeRef(void* handle, void (*release)(void*), bool (*same)(void*, void*))
      : p_(handle, release), same_(same) {}

  void* get() const { return p_.get(); }
  explicit operator bool() const { return p_ != nullptr; }
  const void* identity() const { return p_.get(); }

  /// The same platform object: pointer identity on iOS, IsSameObject on Android.
  bool same(const NativeRef& o) const {
    if (p_ == o.p_) return true;
    if (!p_ || !o.p_) return false;
    return same_ ? same_(get(), o.get()) : get() == o.get();
  }

 private:
  std::shared_ptr<void> p_;
  bool (*same_)(void*, void*) = nullptr;
};

// Namespace-scope, not hidden friends: generated code calls them qualified.
inline bool strictEquals(const NativeRef& a, const NativeRef& b) { return a.same(b); }
inline String toJsString(const NativeRef&) { return String::fromLatin1("[object NativeObject]"); }

/// Runs `job` on the platform's main thread (main queue, main Looper; a
/// dedicated thread standing in for it on other hosts).
void postToMain(std::function<void()> job);
bool onMainThread();

/// A platform callback into Lucent code that returns nothing and outlives
/// the call: queued on the Lucent thread, so the platform never waits for
/// Lucent code. `f` owns what it captured and is released after it runs.
template <class F>
void postCallback(F f) {
  Scheduler::instance().post(std::move(f));
}

/// A platform callback the platform waits for (for its result, or because
/// it runs during the call or on the main thread): runs on the calling
/// thread, holding the Lucent lock. A Lucent error is reported and the
/// platform gets a default result.
template <class F>
auto callNow(F f) -> std::invoke_result_t<F&> {
  using R = std::invoke_result_t<F&>;
  LucentScope scope;
  try {
    return f();
  } catch (...) {
    reportUncaught(std::current_exception(), "callback");
    if constexpr (!std::is_void_v<R>) return R{};
  }
}

/// `main(f)` from lucent:thread: runs `f` on the main thread holding the
/// Lucent lock, and settles the promise with its result. The caller never
/// waits for the main thread, so the lock order stays deadlock-free.
template <class F>
auto runOnMain(F f) -> Promise<std::invoke_result_t<F>> {
  using R = std::invoke_result_t<F>;
  Promise<R> p;
  postToMain([p, f = std::move(f)]() mutable {
    LucentScope scope;
    try {
      if constexpr (std::is_void_v<R>) {
        f();
        p.resolve(undefined);
      } else {
        p.resolve(f());
      }
    } catch (...) {
      p.reject(currentError(std::current_exception()));
    }
  });
  return p;
}

}  // namespace lucent
