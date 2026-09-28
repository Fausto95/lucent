#include "lifecycle.h"

#include <algorithm>
#include <atomic>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>

#include "execution.h"
#include "report.h"

namespace lucent {

namespace detail {

/// One subscription's listener. `live` turns false when it closes, so a
/// report that already took it skips it.
struct LifecycleListener {
  enum class Kind : uint8_t { App, Scene };

  Kind kind;
  uint8_t event;
  Lifecycle::AppListener app;
  Lifecycle::SceneListener scene;
  std::atomic<bool> live{true};
};

struct LifecycleState {
  struct Scene {
    SceneId id;
    /// When it last connected or activated: the order of scenes().
    uint64_t touched;
    std::shared_ptr<Scope> scope;
  };

  struct Subscription {
    std::shared_ptr<LifecycleListener> listener;
    /// Kept here: the subscription lasts until it closes, not until its
    /// handle goes.
    std::shared_ptr<Resource> handle;
  };

  mutable std::mutex m;
  std::vector<Scene> scenes;
  uint64_t touches = 0;
  uint64_t nextSubscription = 1;
  // Keyed by id, so listeners run in subscription order.
  std::map<uint64_t, Subscription> subscriptions;

  Scene* find(SceneId id) {
    auto it = std::find_if(scenes.begin(), scenes.end(), [id](const Scene& s) { return s.id == id; });
    return it == scenes.end() ? nullptr : &*it;
  }

  /// The open listeners of an event, in subscription order.
  std::vector<std::shared_ptr<LifecycleListener>> listenersOf(LifecycleListener::Kind kind, uint8_t event) const {
    std::lock_guard<std::mutex> g(m);
    std::vector<std::shared_ptr<LifecycleListener>> out;

    for (const auto& [id, s] : subscriptions)
      if (s.listener->kind == kind && s.listener->event == event) out.push_back(s.listener);

    return out;
  }
};

}  // namespace detail

namespace {

// Constant-initialized: safe to use during static initialization.
std::atomic<SceneId> nextScene{1};

void requireMain(const char* what) {
  if (!onMainThread()) throw std::logic_error(std::string("Lifecycle::") + what + " is reported on the main thread");
}

/// Runs the listeners a report took, skipping those closed since.
void run(const std::vector<std::shared_ptr<detail::LifecycleListener>>& listeners, SceneId scene) {
  for (const auto& l : listeners) {
    if (!l->live.load(std::memory_order_acquire)) continue;

    try {
      if (l->kind == detail::LifecycleListener::Kind::App) {
        l->app();
      } else {
        l->scene(scene);
      }
    } catch (...) {
      reportUncaught(std::current_exception(), "lifecycle listener");
    }
  }
}

}  // namespace

Lifecycle::Lifecycle() : state_(std::make_shared<detail::LifecycleState>()) {}

Lifecycle::~Lifecycle() {
  std::vector<detail::LifecycleState::Scene> scenes;
  std::map<uint64_t, detail::LifecycleState::Subscription> subscriptions;
  {
    std::lock_guard<std::mutex> g(state_->m);
    scenes.swap(state_->scenes);
    subscriptions.swap(state_->subscriptions);
  }

  for (auto& [id, s] : subscriptions) s.listener->live.store(false, std::memory_order_release);

  for (auto& scene : scenes)
    if (auto e = scene.scope->dispose()) reportUncaught(e, "scene");
}

Lifecycle& Lifecycle::shared() {
  // Never destroyed: the platform may report while the process exits.
  static auto* lifecycle = new Lifecycle();
  return *lifecycle;
}

SceneId Lifecycle::connect() {
  requireMain("connect");

  SceneId id = nextScene.fetch_add(1);

  std::lock_guard<std::mutex> g(state_->m);
  state_->scenes.push_back({id, ++state_->touches, Scope::create(0)});

  return id;
}

void Lifecycle::report(SceneId scene, SceneEvent event) {
  requireMain("report");

  {
    std::lock_guard<std::mutex> g(state_->m);
    detail::LifecycleState::Scene* known = state_->find(scene);
    if (!known) return;

    if (event == SceneEvent::DidActivate) known->touched = ++state_->touches;
  }

  run(state_->listenersOf(detail::LifecycleListener::Kind::Scene, static_cast<uint8_t>(event)), scene);

  if (event != SceneEvent::DidDisconnect) return;

  std::shared_ptr<Scope> scope;
  {
    std::lock_guard<std::mutex> g(state_->m);
    auto& scenes = state_->scenes;
    auto it = std::find_if(scenes.begin(), scenes.end(), [scene](const auto& s) { return s.id == scene; });
    if (it == scenes.end()) return;

    scope = std::move(it->scope);
    scenes.erase(it);
  }

  if (auto e = scope->dispose()) reportUncaught(e, "scene");
}

void Lifecycle::report(AppEvent event) {
  requireMain("report");

  run(state_->listenersOf(detail::LifecycleListener::Kind::App, static_cast<uint8_t>(event)), 0);
}

std::vector<SceneId> Lifecycle::scenes() const {
  std::vector<detail::LifecycleState::Scene> scenes;
  {
    std::lock_guard<std::mutex> g(state_->m);
    scenes = state_->scenes;
  }

  std::sort(scenes.begin(), scenes.end(), [](const auto& a, const auto& b) { return a.touched > b.touched; });

  std::vector<SceneId> out;
  for (const auto& s : scenes) out.push_back(s.id);
  return out;
}

std::shared_ptr<Scope> Lifecycle::sceneScope(SceneId scene) const {
  std::lock_guard<std::mutex> g(state_->m);
  detail::LifecycleState::Scene* known = state_->find(scene);

  return known ? known->scope : nullptr;
}

std::shared_ptr<Resource> Lifecycle::subscribe(AppEvent event, AppListener listener, const std::shared_ptr<Scope>& scope) {
  if (!listener) throw std::invalid_argument("A lifecycle listener must be a function");

  auto l = std::make_shared<detail::LifecycleListener>();
  l->kind = detail::LifecycleListener::Kind::App;
  l->event = static_cast<uint8_t>(event);
  l->app = std::move(listener);

  return add(std::move(l), scope);
}

std::shared_ptr<Resource> Lifecycle::subscribe(SceneEvent event, SceneListener listener, const std::shared_ptr<Scope>& scope) {
  if (!listener) throw std::invalid_argument("A lifecycle listener must be a function");

  auto l = std::make_shared<detail::LifecycleListener>();
  l->kind = detail::LifecycleListener::Kind::Scene;
  l->event = static_cast<uint8_t>(event);
  l->scene = std::move(listener);

  return add(std::move(l), scope);
}

std::shared_ptr<Resource> Lifecycle::add(std::shared_ptr<detail::LifecycleListener> listener, const std::shared_ptr<Scope>& scope) {
  uint64_t id;
  {
    std::lock_guard<std::mutex> g(state_->m);
    id = state_->nextSubscription++;
  }

  std::weak_ptr<detail::LifecycleState> weak = state_;
  auto release = [weak, listener, id] {
    listener->live.store(false, std::memory_order_release);

    // Taken out under the lock and destroyed after it: the listener's
    // captures, and the table's reference to this subscription.
    detail::LifecycleState::Subscription removed;
    if (auto state = weak.lock()) {
      std::lock_guard<std::mutex> g(state->m);
      auto it = state->subscriptions.find(id);
      if (it == state->subscriptions.end()) return;

      removed = std::move(it->second);
      state->subscriptions.erase(it);
    }
  };

  // Opened first: under a scope that has ended, it closes at once, before
  // it is ever listed.
  std::shared_ptr<Resource> handle = Resource::open(String::fromLatin1("Lifecycle subscription"), std::move(release), nullptr, scope);
  if (!handle->isOpen()) return handle;

  std::lock_guard<std::mutex> g(state_->m);
  // Closed by its scope on another thread in the meantime: never listed.
  if (!listener->live.load(std::memory_order_acquire)) return handle;

  state_->subscriptions.emplace(id, detail::LifecycleState::Subscription{std::move(listener), handle});
  return handle;
}

size_t Lifecycle::subscriptions() const {
  std::lock_guard<std::mutex> g(state_->m);
  return state_->subscriptions.size();
}

std::optional<SceneId> presentingScene(const std::vector<SceneId>& scenes, const std::function<SceneState(SceneId)>& stateOf) {
  for (SceneState wanted : {SceneState::ForegroundActive, SceneState::ForegroundInactive})
    for (SceneId s : scenes)
      if (stateOf(s) == wanted) return s;

  return std::nullopt;
}

}  // namespace lucent
