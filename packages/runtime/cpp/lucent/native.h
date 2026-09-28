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

/// How many platform objects Lucent holds (NativeRefs, not copies), until
/// each is released.
long liveNativeRefs();

/// The part of liveNativeRefs() module code made: not the main context's
/// (views' setups and the callbacks they give the platform, which the
/// renderer and the platform's garbage collector release on their own
/// schedule), nor the ones kept for the process. Debug builds report what
/// is left when a JavaScript runtime's module goes.
long moduleNativeRefs();

namespace detail {
/// Counts a platform object Lucent now holds; whether module code made it.
bool countNativeRef();

/// Counts one released (or kept for the process: `held` then stays true).
void uncountNativeRef(bool module, bool held = false);

/// Releases `handle` on `on`'s thread: at once there, or with no context;
/// else posted to it (or here, if it takes no more work).
void releaseNative(void* handle, void (*release)(void*), ExecutionContext* on, bool module);
}  // namespace detail

class NativeRef {
 public:
  NativeRef() = default;

  /// Takes ownership of `handle`; `release` runs when the last copy goes,
  /// on the thread `releaseOn` runs on if the object requires one (UIKit
  /// objects, the main context's), whichever thread dropped that copy.
  NativeRef(void* handle, void (*release)(void*), bool (*same)(void*, void*), ExecutionContext* releaseOn = nullptr)
      : p_(handle, Release{release, releaseOn, handle && detail::countNativeRef()}), same_(same) {}

  void* get() const { return p_.get(); }
  explicit operator bool() const { return p_ != nullptr; }
  const void* identity() const { return p_.get(); }

  /// The object lives as long as the process (the Android Application):
  /// the teardown report leaves it out. Any copy; once.
  void keepForProcess() {
    auto* r = std::get_deleter<Release>(p_);

    if (r && r->module) {
      r->module = false;
      detail::uncountNativeRef(true, true);
    }
  }

  /// The same platform object: pointer identity on iOS, IsSameObject on Android.
  bool same(const NativeRef& o) const {
    if (p_ == o.p_) return true;
    if (!p_ || !o.p_) return false;
    return same_ ? same_(get(), o.get()) : get() == o.get();
  }

 private:
  struct Release {
    void (*release)(void*);
    ExecutionContext* on;
    /// Counted as module code's (moduleNativeRefs).
    bool module;

    void operator()(void* p) const {
      if (p) detail::releaseNative(p, release, on, module);
    }
  };
  std::shared_ptr<void> p_;
  bool (*same_)(void*, void*) = nullptr;
};

// Namespace-scope, not hidden friends: generated code calls them qualified.
inline bool strictEquals(const NativeRef& a, const NativeRef& b) { return a.same(b); }
inline String toJsString(const NativeRef&) { return String::fromLatin1("[object NativeObject]"); }

// --- the legacy module context ----------------------------------------------
//
// What generated module code calls: each enters module code by taking the
// Lucent lock.

/// A platform callback into module code that returns nothing and outlives
/// the call: a turn of the legacy module context on the Lucent thread, so
/// the platform never waits for Lucent code. `f` owns what it captured and
/// is released after it runs.
template <class F>
void postCallback(F f) {
  Scheduler::instance().post(std::move(f));
}

/// A platform callback into module code the platform waits for (for its
/// result, or because it runs during the call or on the main thread): runs
/// on the calling thread, holding the Lucent lock. A Lucent error is
/// reported and the platform gets a default result.
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

/// `main(f)` from lucent:thread, kept for module code: runs `f` on the main
/// thread holding the Lucent lock, and settles the promise with its result.
/// The caller never waits for the main thread, so the lock order stays
/// deadlock-free, but the main thread waits for any module job. UI work
/// uses the main context (runIn) instead.
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

// --- any other context -------------------------------------------------------
//
// The same entries for another context, such as the main context: none
// takes the Lucent lock.

/// A platform callback into `context` that returns nothing and outlives the
/// call: a turn of that context. `f` owns what it captured and is released
/// on the context after it runs (or at once if the context has shut down).
template <class F>
void postTo(ExecutionContext& context, F f) {
  context.post(std::move(f));
}

/// A platform callback into `context` the platform waits for, made on the
/// context's own thread (the main thread, for the main context): runs now,
/// in the context, and the microtasks it queued run before it returns. A
/// Lucent error, or a call from any other thread, is reported and the
/// platform gets a default result.
template <class F>
auto callNowIn(ExecutionContext& context, F f) -> std::invoke_result_t<F&> {
  using R = std::invoke_result_t<F&>;
  try {
    ContextEntry entry(context);
    return f();
  } catch (...) {
    reportUncaught(std::current_exception(), "callback");
    if constexpr (!std::is_void_v<R>) return R{};
  }
}

/// Runs `f` as a turn of `context` and settles the promise, which belongs to
/// the calling context, with its result there; a context that has shut down
/// rejects it. Neither side waits for the other. What `f` captures and
/// returns crosses threads, so it must not share mutable state with the
/// caller.
template <class F>
auto runIn(ExecutionContext& context, F f) -> Promise<std::invoke_result_t<F>> {
  using R = std::invoke_result_t<F>;
  Promise<R> p;

  bool posted = context.post([p, f = std::move(f)]() mutable {
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

  if (!posted) p.reject(makeError(String::fromLatin1("AbortError"), String::fromLatin1("The execution context has shut down")));

  return p;
}

}  // namespace lucent
