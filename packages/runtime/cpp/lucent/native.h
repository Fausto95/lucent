// Lucent runtime — platform objects and the main thread.
//
// A NativeRef holds an Objective-C object (retained) or a JNI global
// reference. It is opaque here, so generated headers stay plain C++; the
// glue in *.ios.lucent.ts (.mm) and *.android.lucent.ts units wraps and
// unwraps it (lucent/platform/ios.h, lucent/platform/android.h).
#pragma once

#include <functional>
#include <memory>
#include <optional>
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

// --- module actors --------------------------------------------------------------
//
// What generated module code calls: each enters module code by taking its
// actor's lock. Generated code names its actor (lucent_app::actor_N); the
// forms without one use the shared actor.

/// A platform callback into module code that returns nothing and outlives
/// the call: a turn of `actor` on its thread, so the platform never waits
/// for Lucent code. `f` owns what it captured and is released after it runs.
template <class F>
void postCallback(Actor& actor, F f) {
  actor.post(std::move(f));
}

template <class F>
void postCallback(F f) {
  postCallback(Actor::shared(), std::move(f));
}

/// A platform callback into module code the platform waits for (for its
/// result, or because it runs during the call): runs on the calling thread,
/// holding `actor`'s lock. On the main thread it never queues behind module
/// jobs: it waits only for the holder in place (LucentLock::lockFromMain),
/// or borrows the actor from a JavaScript callback. A Lucent error (a
/// deadlock refused included) is reported and the platform gets a default
/// result.
template <class F>
auto callNow(Actor& actor, F f) -> std::invoke_result_t<F&> {
  using R = std::invoke_result_t<F&>;
  try {
    std::optional<LucentScope> scope;
    if (onMainThread()) {
      scope.emplace(actor, LucentScope::FromMain{});
    } else {
      scope.emplace(actor);
    }

    return f();
  } catch (...) {
    reportUncaught(std::current_exception(), "callback");
    if constexpr (!std::is_void_v<R>) return R{};
  }
}

template <class F>
auto callNow(F f) -> std::invoke_result_t<F&> {
  return callNow(Actor::shared(), std::move(f));
}

namespace detail {
template <class F>
void enterFromMain(Actor& actor, std::shared_ptr<F> f) {
  if (!actor.lock().tryLockFromMain()) {
    // Not now: once the actor is free, posted to the main thread again.
    actor.lock().whenFree([actor = &actor, f] { enterFromMain(*actor, f); });
    return;
  }

  LucentScope scope(actor, std::adopt_lock);
  Job job = [f] { (*f)(); };
  runGuarded(job, "callback");
}
}  // namespace detail

/// On the main thread: runs `f` there, holding `actor`'s lock, as soon as
/// the main thread can take it without waiting (at once if it is free, or
/// lent by a JavaScript callback); until then the main thread goes on with
/// other work. What `f` throws is reported.
template <class F>
void enterFromMain(Actor& actor, F f) {
  detail::enterFromMain(actor, std::make_shared<F>(std::move(f)));
}

/// The actor the calling module code runs on (the shared one outside any).
inline Actor& currentActor() {
  Actor* actor = Actor::current();
  return actor ? *actor : Actor::shared();
}

/// `main(f)` from lucent:thread: runs `f` on the main thread holding the
/// calling module's actor (enterFromMain), and settles the promise with its
/// result. Neither side waits for the other: the main thread runs `f` once
/// the actor is free, so a long module job delays `f`, never the main
/// thread. UI work uses the main context (runIn) instead.
template <class F>
auto runOnMain(F f) -> Promise<std::invoke_result_t<F>> {
  using R = std::invoke_result_t<F>;
  Promise<R> p;
  Actor& actor = currentActor();

  postToMain([actor = &actor, p, f = std::move(f)]() mutable {
    enterFromMain(*actor, [p, f = std::move(f)]() mutable {
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
  });
  return p;
}

// --- any other context -------------------------------------------------------
//
// The same entries for another context, such as the main context: none
// takes an actor's lock.

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
