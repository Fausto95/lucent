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

  /// The same platform object (`===`): pointer identity on iOS, IsSameObject on Android.
  friend bool strictEquals(const NativeRef& a, const NativeRef& b) {
    if (a.p_ == b.p_) return true;
    if (!a.p_ || !b.p_) return false;
    return a.same_ ? a.same_(a.get(), b.get()) : a.get() == b.get();
  }
  friend String toJsString(const NativeRef&) { return String::fromLatin1("[object NativeObject]"); }

 private:
  std::shared_ptr<void> p_;
  bool (*same_)(void*, void*) = nullptr;
};

/// Runs `job` on the platform's main thread (main queue, main Looper; a
/// dedicated thread standing in for it on other hosts).
void postToMain(std::function<void()> job);
bool onMainThread();

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
