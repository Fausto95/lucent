// Lucent runtime — what compiled views share: the main context's reactive
// graph, their events' routes, where their errors go, and how a mount's
// host hears that the mount's code ran.
//
// A component's setup runs once per mount, on the main context, inside the
// mount's scope (reactive.h). Its props are signals of that graph; its
// events are routes its host points at the mount's current event emitter.
// Nothing here knows React Native: the generated mount glue does.
//
// A host sizing a component by its content must measure it again after
// the mount's code changed its views. It cannot see those changes, so it
// hears of every entry into the mount instead (Content): its own calls
// (setup, commits, commands) and every function the setup made (native
// callbacks, effects, handlers), which enter the mount whenever they run.
// The host hears once, when the outermost entry on the main thread ends.
#pragma once

#include <exception>
#include <functional>
#include <memory>
#include <type_traits>
#include <utility>
#include <vector>

#include "json.h"
#include "reactive.h"
#include "ui_children.h"

namespace lucent::ui {

/// The main context's graph, which every view's props, signals and effects
/// share. Made on first use; used only on the main context.
std::shared_ptr<Graph> mainGraph();

/// A component's event, as its setup sees it: calling it sends the
/// arguments along the route its host installed, or nowhere without one.
/// Copies share the route, so the host redirects events (a new emitter,
/// JavaScript no longer listening) without the setup, or the native
/// subscriptions it made, running again. Used on the main context.
template <class... Args>
class Event {
 public:
  using Route = std::function<void(Args...)>;

  Event() : route_(std::make_shared<Route>()) {}

  void route(Route route) const { *route_ = std::move(route); }

  void operator()(Args... args) const {
    // A copy: the route may replace itself while it runs.
    if (Route r = *route_) r(std::move(args)...);
  }

 private:
  std::shared_ptr<Route> route_;
};

}  // namespace lucent::ui

namespace lucent {

// A signal as a JavaScript value: an object compared by identity, whose
// JSON is an object with no own properties.
template <class T>
bool strictEquals(const ui::Signal<T>& a, const ui::Signal<T>& b) {
  return a.identity() == b.identity();
}

template <class T>
String toJsString(const ui::Signal<T>&) {
  return String::fromLatin1("[object Object]");
}

template <class T>
void jsonWrite(JsonWriter& w, const ui::Signal<T>&) {
  w.raw("{}");
}

}  // namespace lucent

namespace lucent::ui {

/// Reports a view's error nobody can catch (its setup's, a command's) with
/// the component's identity, what failed and the source line it maps to.
void reportViewError(std::exception_ptr error, const char* component, const char* what, const char* source);

/**
 * A mount's native content, as its host sizes it. Marked whenever the
 * mount's code runs, or by invalidateSize(); the host's `changed` runs
 * once for any number of marks: when the outermost entry into a mount
 * ends, or in a later turn of the main context for a mark made outside
 * any. Code of the mount may listen too (a Flex marking its leaves to
 * measure again): listeners hear first, in the order they listened, then
 * the host. Marks made while they run (measuring may run the mount's
 * code) are not changes. Main thread only.
 */
class Content : public std::enable_shared_from_this<Content> {
  struct Token {};

 public:
  static std::shared_ptr<Content> create(std::function<void()> changed);

  Content(Token, std::function<void()> changed) : changed_(std::move(changed)) {}

  Content(const Content&) = delete;
  Content& operator=(const Content&) = delete;

  /// Marks the content changed.
  void invalidate();

  /// Calls `listener` at each change, before the host; unlisten() takes it back.
  size_t listen(std::function<void()> listener);
  void unlisten(size_t id);

 private:
  friend class ContentEntry;

  /// Runs `changed` for what is marked.
  static void flush();

  std::function<void()> changed_;
  std::vector<std::pair<size_t, std::function<void()>>> listeners_;
  size_t nextListener_ = 0;
  bool marked_ = false;
  bool measuring_ = false;
};

/// The content of the mount whose code runs now on the main thread (empty
/// outside any, and off the main thread).
std::weak_ptr<Content> activeContent();

/**
 * While one lives, `content`'s mount runs (on the main thread, in the main
 * context or not, as hosts call their mounts; elsewhere, or for a mount
 * that has gone, it does nothing): the content is marked, and ending the
 * outermost entry reports every content marked meanwhile.
 */
class ContentEntry {
 public:
  explicit ContentEntry(const std::weak_ptr<Content>& content);
  ~ContentEntry();

  ContentEntry(const ContentEntry&) = delete;
  ContentEntry& operator=(const ContentEntry&) = delete;

 private:
  bool entered_ = false;
  std::weak_ptr<Content> outer_;
};

/// `f`, entering `content`'s mount whenever it runs: a function a setup made.
template <class F>
auto inContent(std::weak_ptr<Content> content, F f) {
  return [content = std::move(content), f = std::move(f)](auto&&... args) mutable
         -> std::invoke_result_t<F&, decltype(args)...> {
    ContentEntry entry(content);

    return f(std::forward<decltype(args)>(args)...);
  };
}

/// lucent:ui's invalidateSize(): marks `content` (the mount of the setup
/// the call is written in) changed; nothing once the mount has gone.
void invalidateSize(const std::weak_ptr<Content>& content);

}  // namespace lucent::ui
