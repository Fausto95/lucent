// Lucent runtime — UIKit glue: the scene to present from, presentations,
// and lifecycle subscriptions, for *.ios.lucent.ts units and native
// wrappers (Objective-C++ with ARC, iOS only).
//
// Nothing here keeps a window or view controller: the presentation context
// is looked up in UIKit's scenes each time it is asked for, and scenes are
// named by SceneIds (lucent/lifecycle.h). UIKit's notifications feed the
// shared Lifecycle from the moment the binary loads; no app or scene
// delegate is replaced, so the app's own, and other modules', keep working.
#pragma once

#import <UIKit/UIKit.h>

#include <functional>
#include <memory>
#include <optional>
#include <type_traits>

#include "../lifecycle.h"
#include "../presentation.h"
#include "ios.h"

namespace lucent::objc {

/// Where to present from, as UIKit has it now.
struct PresentationContext {
  SceneId id = 0;
  UIWindowScene* scene = nil;
  UIWindow* window = nil;
  /// The key window's root view controller, or the view controller it
  /// presents (and so on), minus one being dismissed.
  UIViewController* top = nil;
};

/**
 * The presentation context of the scene the person is using: the most
 * recently activated window scene in the foreground (active before
 * inactive), its key window and top view controller. None while every
 * scene is in the background, or it has no window with a root view
 * controller. On the main thread only (InvalidStateError elsewhere). Keep
 * none of it past the current turn of the main thread: ask again.
 */
std::optional<PresentationContext> presentationContext();

/// The id of a connected scene (given when UIKit connects it, or when it
/// is first seen); 0 for nil. Main thread.
SceneId sceneIdOf(UIScene* scene);

/// The connected scene with that id, else nil. Main thread.
UIScene* sceneOf(SceneId id);

namespace detail {

/**
 * Presents `viewController` from the top view controller of `scene`'s key
 * window, and returns what dismisses it: at once if it is shown, else once
 * UIKit has shown it (some view controllers appear later than the call).
 * `dismissed` runs once if, before that, the person dismisses it (a sheet
 * swiped down) or it is released. Throws InvalidStateError if it is
 * already shown, another presentation is under way, or UIKit throws.
 * Main thread.
 */
std::function<void()> show(SceneId scene, UIViewController* viewController, bool animated, std::function<void()> dismissed);

/// What cancels a presentation the person dismissed: an AbortError.
Error dismissedError();

/// The root scope of the calling context: what Lucent code's presentations
/// and subscriptions belong to.
std::shared_ptr<Scope> callerScope();

}  // namespace detail

/**
 * For native wrappers: presents, on the main thread, the view controller
 * `build` returns, from the presentation context now, as an operation under
 * `scope` (lucent/presentation.h: it settles once, and whatever settles it
 * dismisses the view controller). `build` runs here, before anything is
 * shown, and wires the view controller's own outcome (a delegate, a
 * completion handler) to the operation; it may settle it at once, and then
 * nothing is shown. The person dismissing it, or its release, cancels the
 * operation with an AbortError; so does its scene disconnecting.
 */
template <class T>
std::shared_ptr<Operation<T>> presentOperation(const std::shared_ptr<Scope>& scope, Opt<AbortSignal> signal,
                                               const std::function<UIViewController*(const std::shared_ptr<Operation<T>>&)>& build,
                                               bool animated = true) {
  std::optional<PresentationContext> context = presentationContext();
  SceneId scene = context ? context->id : 0;

  return presentIn<T>(Lifecycle::shared(), scene, scope, signal, [&](const std::shared_ptr<Operation<T>>& op) -> std::function<void()> {
    UIViewController* viewController = build(op);
    if (op->state() != OperationState::Pending) return {};
    if (!viewController) returnedNil("present's view controller");

    std::weak_ptr<Operation<T>> weak = op;
    return detail::show(scene, viewController, animated, [weak] {
      if (auto op = weak.lock()) op->cancel(detail::dismissedError());
    });
  });
}

namespace detail {
template <class T>
struct ResolveOf {
  using type = Fn<void(T)>;
};
template <>
struct ResolveOf<void> {
  using type = Fn<void()>;
};
}  // namespace detail

/// What `present` gives its function to settle with a value.
template <class T>
using Resolve = typename detail::ResolveOf<T>::type;

/**
 * `present(build, signal)` from lucent:ios: on the main thread, holding the
 * Lucent lock (build is module code), presents the view controller `build`
 * returns (presentOperation) under the calling context's root scope, and
 * settles the promise, which belongs to the calling context, with the
 * outcome.
 */
template <class T>
Promise<T> present(Fn<NativeRef(Resolve<T>, Fn<void(Error)>)> build, Opt<AbortSignal> signal = {}) {
  Promise<T> promise;
  std::shared_ptr<Scope> scope = detail::callerScope();

  postToMain([promise, build = std::move(build), signal, scope]() mutable {
    LucentScope lucent;

    std::shared_ptr<Operation<T>> op;
    try {
      op = presentOperation<T>(scope, signal, [&](const std::shared_ptr<Operation<T>>& op) -> UIViewController* {
        std::weak_ptr<Operation<T>> weak = op;

        Resolve<T> resolve;
        if constexpr (std::is_void_v<T>) {
          resolve = Resolve<T>([weak] {
            if (auto op = weak.lock()) op->succeed();
          });
        } else {
          resolve = Resolve<T>([weak](T value) {
            if (auto op = weak.lock()) op->succeed(std::move(value));
          });
        }

        Fn<void(Error)> reject([weak](Error error) {
          if (auto op = weak.lock()) op->fail(std::move(error));
        });

        id made = unwrap(build(resolve, reject));
        if (made && ![made isKindOfClass:[UIViewController class]])
          throw Exception(makeError(String::fromLatin1("TypeError"), String::fromLatin1("present's function must return a UIViewController")));

        return (UIViewController*)made;
      });
    } catch (...) {
      promise.reject(currentError(std::current_exception()));
      return;
    }

    op->onSettled([promise](const typename Operation<T>::Outcome& outcome) {
      if (outcome.state != OperationState::Succeeded) {
        promise.reject(outcome.error);
      } else if constexpr (std::is_void_v<T>) {
        promise.resolve(undefined);
      } else {
        promise.resolve(*outcome.value);
      }
    });
  });

  return promise;
}

/**
 * `onAppEvent(event, listener, signal)` from lucent:ios: calls `listener`
 * on each of UIApplication's `event` notifications ("didBecomeActive"…),
 * on the main thread holding the Lucent lock, until the returned function
 * is called or `signal` aborts. What it throws is reported; UIKit and the
 * other observers go on.
 */
Fn<void()> onAppEvent(const String& event, Fn<void()> listener, Opt<AbortSignal> signal = {});

/// `onSceneEvent(event, listener, signal)` from lucent:ios: as onAppEvent,
/// for UIScene's notifications ("willConnect"…); `listener` gets the
/// scene's session's persistent identifier.
Fn<void()> onSceneEvent(const String& event, Fn<void(String)> listener, Opt<AbortSignal> signal = {});

}  // namespace lucent::objc
