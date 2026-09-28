// Lucent runtime — the app's and its scenes' lifecycle.
//
// The platform adapter (lucent/platform/ios_ui.mm) reports what the
// platform posts, on the main thread: the app becoming active or going to
// the background, and each scene connecting, activating, and
// disconnecting. Lucent code subscribes to those events. Nothing here
// knows UIKit: a scene is a SceneId, never a pointer, so nothing here can
// keep a window or view controller alive.
//
// Each connected scene has a scope, disposed when the scene disconnects:
// work tied to what the scene shows (a presentation, say) ends with it.
#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <vector>

#include "resource.h"
#include "scope.h"

namespace lucent {

/// Process-unique and never reused; 0 is none.
using SceneId = uint64_t;

/// UIApplication's lifecycle notifications.
enum class AppEvent : uint8_t {
  DidBecomeActive,
  WillResignActive,
  DidEnterBackground,
  WillEnterForeground,
  DidReceiveMemoryWarning,
  WillTerminate,
};

/// UIScene's lifecycle notifications.
enum class SceneEvent : uint8_t {
  WillConnect,
  DidDisconnect,
  DidActivate,
  WillDeactivate,
  WillEnterForeground,
  DidEnterBackground,
};

/// UIScene.ActivationState.
enum class SceneState : uint8_t { Unattached, ForegroundActive, ForegroundInactive, Background };

namespace detail {
struct LifecycleState;
struct LifecycleListener;
}

/// What the platform reported, and who listens. Construction does nothing
/// else; destruction disposes the scopes of the scenes still connected.
class Lifecycle {
 public:
  using AppListener = std::function<void()>;
  using SceneListener = std::function<void(SceneId)>;

  Lifecycle();
  ~Lifecycle();

  Lifecycle(const Lifecycle&) = delete;
  Lifecycle& operator=(const Lifecycle&) = delete;

  /// The process's, which the platform adapter reports to.
  static Lifecycle& shared();

  // --- what the platform reports: on the main thread only (std::logic_error
  // elsewhere) -------------------------------------------------------------

  /// A scene the platform connected, or found connected: its new id, and a
  /// scope for it. Nothing is announced: the platform reports WillConnect
  /// once it can name the scene.
  SceneId connect();

  /// Runs the event's listeners with the scene. DidActivate makes it the
  /// most recently activated; DidDisconnect, after the listeners ran,
  /// disposes its scope and forgets it. A scene it does not know is
  /// ignored.
  void report(SceneId scene, SceneEvent event);

  void report(AppEvent event);

  // --- what it knows: any thread ------------------------------------------

  /// The connected scenes, most recently activated first (or, until
  /// activated, connected).
  std::vector<SceneId> scenes() const;

  /// The scene's scope while it is connected, else null.
  std::shared_ptr<Scope> sceneScope(SceneId scene) const;

  // --- subscriptions: any thread ------------------------------------------

  /// Calls `listener` on each `event`, on the main thread, from the next
  /// report on. The subscription is open until it is closed or `scope` is
  /// disposed (under a scope that has ended, it is closed at once);
  /// dropping the handle does not end it. Closed on the main thread, its
  /// listener never runs again; closed on another thread while an event is
  /// being reported, it may still hear that event (closing never waits).
  /// What a listener throws is reported (reportUncaught), and the rest
  /// still run.
  std::shared_ptr<Resource> subscribe(AppEvent event, AppListener listener, const std::shared_ptr<Scope>& scope = nullptr);
  std::shared_ptr<Resource> subscribe(SceneEvent event, SceneListener listener, const std::shared_ptr<Scope>& scope = nullptr);

  /// Open subscriptions (for debug ownership reports and tests).
  size_t subscriptions() const;

 private:
  std::shared_ptr<Resource> add(std::shared_ptr<detail::LifecycleListener> listener, const std::shared_ptr<Scope>& scope);

  const std::shared_ptr<detail::LifecycleState> state_;
};

/// The scene to present from, of `scenes` (most recently activated first):
/// the first in the foreground and active, else the first in the
/// foreground; none while every scene is in the background or unattached.
std::optional<SceneId> presentingScene(const std::vector<SceneId>& scenes, const std::function<SceneState(SceneId)>& stateOf);

}  // namespace lucent
