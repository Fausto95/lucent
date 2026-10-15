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
 * Presents `viewController` from `from` (a component's view controller,
 * presenterOf), else from the top view controller of `scene`'s key
 * window, and returns what dismisses it: at once if it is shown, else once
 * UIKit has shown it (some view controllers appear later than the call).
 * `dismissed` runs once if, before that, the person dismisses it (a sheet
 * swiped down) or it is released. Throws InvalidStateError if it is
 * already shown, another presentation is under way, or UIKit throws.
 * Main thread.
 */
std::function<void()> show(SceneId scene, UIViewController* viewController, bool animated, std::function<void()> dismissed,
                           UIViewController* from = nil);

/**
 * Where Lucent code presents from now: while a component's code runs on
 * the main thread (its setup, a commit, a command, a function its setup
 * made, up to its first await), its mount's scope and its setup's root
 * (T122); elsewhere, nothing.
 */
struct Presenter {
  std::shared_ptr<Scope> scope;
  NativeRef root;
};
Presenter presenterNow();

/**
 * The view controller to present from for a component's root: the root,
 * if it is a view controller in a window with nothing presented over it
 * yet; else nil, for the scene's top view controller. Main thread.
 */
UIViewController* presenterOf(const NativeRef& root);

/// What cancels a presentation the person dismissed: an AbortError.
Error dismissedError();

/// The root scope of the calling context: what Lucent code's presentations
/// and subscriptions belong to.
std::shared_ptr<Scope> callerScope();
/// A subscription as the function that ends it, also ended by `signal`.
Fn<void()> stopper(std::shared_ptr<Resource> subscription, Opt<AbortSignal> signal);
/// Whether `signal` has aborted already, so nothing subscribes.
bool abortedAlready(const Opt<AbortSignal>& signal);

}  // namespace detail

/**
 * For native wrappers: presents, on the main thread, the view controller
 * `build` returns, from the presentation context now, as an operation under
 * `scope` (lucent/presentation.h: it settles once, and whatever settles it
 * dismisses the view controller). `build` runs here, before anything is
 * shown, and wires the view controller's own outcome (a delegate, a
 * completion handler) to the operation; it may settle it at once, and then
 * nothing is shown. The person dismissing it, or its release, cancels the
 * operation with an AbortError; so does its scene disconnecting. `from`, a
 * component's root, is what it presents from when it can (presenterOf).
 */
template <class T>
std::shared_ptr<Operation<T>> presentOperation(const std::shared_ptr<Scope>& scope, Opt<AbortSignal> signal,
                                               const std::function<UIViewController*(const std::shared_ptr<Operation<T>>&)>& build,
                                               bool animated = true, const NativeRef& from = {}) {
  UIViewController* presenter = detail::presenterOf(from);
  SceneId scene = presenter ? sceneIdOf(presenter.viewIfLoaded.window.windowScene) : 0;

  if (!presenter) {
    std::optional<PresentationContext> context = presentationContext();
    scene = context ? context->id : 0;
  }

  return presentIn<T>(Lifecycle::shared(), scene, scope, signal, [&](const std::shared_ptr<Operation<T>>& op) -> std::function<void()> {
    UIViewController* viewController = build(op);
    if (op->state() != OperationState::Pending) return {};
    if (!viewController) returnedNil("present's view controller");

    std::weak_ptr<Operation<T>> weak = op;
    return detail::show(
        scene, viewController, animated,
        [weak] {
          if (auto op = weak.lock()) op->cancel(detail::dismissedError());
        },
        presenter);
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
 * calling module's actor (build is module code) once the main thread can
 * take it without waiting (enterFromMain), presents the view controller
 * `build` returns (presentOperation) under the calling context's root
 * scope, and settles the promise, which belongs to the calling context,
 * with the outcome. A component's code presents from its view controller,
 * under its mount's scope, so the mount's end dismisses it (presenterNow).
 */
template <class T>
Promise<T> present(Fn<NativeRef(Resolve<T>, Fn<void(Error)>)> build, Opt<AbortSignal> signal = {}) {
  Promise<T> promise;
  detail::Presenter presenter = detail::presenterNow();
  std::shared_ptr<Scope> scope = presenter.scope ? presenter.scope : detail::callerScope();
  NativeRef from = presenter.root;
  Actor& actor = currentActor();

  postToMain([actor = &actor, promise, build = std::move(build), signal, scope, from]() mutable {
    enterFromMain(*actor, [promise, build = std::move(build), signal, scope, from]() mutable {
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
        }, true, from);
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
  });

  return promise;
}

/**
 * `onAppEvent(event, listener, signal)` from lucent:ios: calls `listener`
 * on each of UIApplication's `event` notifications ("didBecomeActive"…),
 * on the main thread holding the subscriber's actor, once the main thread
 * can take it without waiting (enterFromMain: a busy actor delays the
 * listener, never the main thread), until the returned function is called
 * or `signal` aborts. What it throws is reported; UIKit and the
 * other observers go on.
 */
Fn<void()> onAppEvent(const String& event, Fn<void()> listener, Opt<AbortSignal> signal = {});

/// `onSceneEvent(event, listener, signal)` from lucent:ios: as onAppEvent,
/// for UIScene's notifications ("willConnect"…); `listener` gets the
/// scene's session's persistent identifier.
Fn<void()> onSceneEvent(const String& event, Fn<void(String)> listener, Opt<AbortSignal> signal = {});

/**
 * Calls `handler` with the control on each of `events` (a UIControlEvents
 * mask): a JSX element's control event (T48), as the UIAction UIKit
 * registers. Gives the action, for removeControlAction: the control keeps
 * it, and through it the handler, until then.
 */
template <class Handler>
NativeRef addControlAction(id control, NSUInteger events, Handler handler) {
  UIAction* action = [UIAction actionWithHandler:^(UIAction* a) {
    handler(a.sender);
  }];
  [(UIControl*)control addAction:action forControlEvents:(UIControlEvents)events];
  return wrap(action, "a control's action");
}

/** Takes back an action addControlAction registered. */
inline void removeControlAction(id control, const NativeRef& action, NSUInteger events) {
  [(UIControl*)control removeAction:(UIAction*)unwrap(action) forControlEvents:(UIControlEvents)events];
}

}  // namespace lucent::objc
