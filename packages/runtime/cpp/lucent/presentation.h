// Lucent runtime — presentations: UI shown in a scene until a result.
//
// Presenting a view controller, or a system sheet, and waiting for what
// the person does there is a one-shot operation (scope.h) under the
// caller's scope, tied to the scene it is shown in. It settles exactly
// once, at the first of: a result or an error, the caller's signal, the
// disposal of the caller's scope, or the scene disconnecting. Whatever
// settles it, what it showed is then dismissed, on the main thread.
//
// The platform adapter (lucent/platform/ios_ui.h) shows and dismisses;
// this part knows nothing of UIKit.
#pragma once

#include <functional>
#include <memory>
#include <stdexcept>

#include "abort.h"
#include "execution.h"
#include "lifecycle.h"
#include "scope.h"

namespace lucent {

/// What cancels a presentation whose scene disconnected: an AbortError.
Error sceneGoneError();

/// What fails a presentation with no scene to present from: an
/// InvalidStateError.
Error noSceneError();

/// Shows the UI of `operation`, and returns what dismisses it (or an empty
/// function). It may settle the operation before returning; what it throws
/// fails it.
template <class T>
using Show = std::function<std::function<void()>(const std::shared_ptr<Operation<T>>&)>;

/**
 * Presents UI in `scene` (a scene `lifecycle` knows, else it fails with
 * noSceneError()) as an operation under `scope`. On the main thread only
 * (std::logic_error elsewhere): `show` runs here, now.
 *
 * Already aborted, or under a scope that has ended, it starts cancelled
 * and shows nothing. Afterwards, aborting `signal` cancels it with the
 * signal's reason, disposing `scope` or the scene's disconnecting cancels
 * it with an AbortError. Once it settles, the dismissal `show` returned
 * runs on the main thread (there and then if it settles there, else
 * posted), and nothing refers to the scene or the signal any more.
 */
template <class T>
std::shared_ptr<Operation<T>> presentIn(Lifecycle& lifecycle, SceneId scene, const std::shared_ptr<Scope>& scope, Opt<AbortSignal> signal,
                                        const Show<T>& show) {
  if (!onMainThread()) throw std::logic_error("presentIn runs on the main thread");
  if (!show) throw std::invalid_argument("A presentation's show must be a function");

  AbortSignal abort = signal.has() ? signal.get() : nullptr;
  Opt<Error> abortedBy;
  if (abort && abort->aborted.load()) abortedBy = abort->reason;

  std::shared_ptr<Scope> sceneScope = lifecycle.sceneScope(scene);

  auto registration = [&](const std::shared_ptr<Operation<T>>& op) -> std::function<void()> {
    if (!sceneScope) throwError(noSceneError());

    std::weak_ptr<Operation<T>> weak = op;

    // The scene going cancels it; so does the signal, on the signal's owner.
    Scope::CleanupId gone = sceneScope->onDispose([weak] {
      if (auto op = weak.lock()) op->cancel(sceneGoneError());
    });

    std::weak_ptr<AbortSignalObject> weakSignal = abort;
    uint64_t aborted = abort ? abort->add([weak, weakSignal] {
      auto op = weak.lock();
      auto signal = weakSignal.lock();
      if (op && signal) op->cancel(signal->reason);
    })
                             : 0;

    std::weak_ptr<Scope> weakScene = sceneScope;
    auto unlink = [weakScene, gone, weakSignal, aborted] {
      if (auto s = weakScene.lock(); s && gone) s->remove(gone);
      if (auto s = weakSignal.lock(); s && aborted) s->remove(aborted);
    };

    // The scene went while it was being linked: nothing to show.
    if (op->state() != OperationState::Pending) {
      unlink();
      return {};
    }

    std::function<void()> dismiss;
    try {
      dismiss = show(op);
    } catch (...) {
      unlink();
      throw;
    }

    return [unlink, dismiss = std::move(dismiss)]() mutable {
      unlink();
      if (dismiss) detail::runOn(&ExecutionContext::main(), std::move(dismiss));
    };
  };

  return Operation<T>::start(scope, registration, abortedBy);
}

}  // namespace lucent
