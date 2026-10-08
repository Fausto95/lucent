// Lucent runtime — lucent:core's EventEmitter.
//
// An emitter keeps each event's listeners, in the order they were added,
// and calls them when it emits. Generated code names an event by its index
// in the emitter's type (the compiler knows each name's); JavaScript names
// it by string, which the instance keeps.
//
// A listener JavaScript added belongs to its runtime: once that runtime's
// host is torn down (a reload), the listener is gone, and listenerCount no
// longer counts it. Everything here runs with the Lucent lock held.
#pragma once

#include <cstdint>
#include <functional>
#include <initializer_list>
#include <memory>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "core.h"
#include "function.h"
#include "jsstring.h"

namespace lucent {

/// What addListener returns: remove() takes the listener off, once.
class EventSubscriptionObject : public Object {
 public:
  explicit EventSubscriptionObject(std::function<void()> remove) : remove_(std::move(remove)) {}

  /// Removes the listener; again, does nothing.
  void remove() {
    if (auto f = std::exchange(remove_, nullptr)) f();
  }

 private:
  std::function<void()> remove_;
};

using EventSubscription = Ref<EventSubscriptionObject>;

namespace detail {

/// Calls `f(std::integral_constant<size_t, I>{})` for the I that equals `i` (< N).
template <size_t N, class F, size_t... I>
void withIndex(size_t i, F&& f, std::index_sequence<I...>) {
  ((i == I ? (f(std::integral_constant<size_t, I>{}), 0) : 0), ...);
}

template <size_t N, class F>
void withIndex(size_t i, F&& f) {
  withIndex<N>(i, std::forward<F>(f), std::make_index_sequence<N>{});
}

}  // namespace detail

/// An emitter whose events' listeners have the types `Fns` (each a
/// Fn<void(A...)>), in the order of `names`.
template <class... Fns>
class EventEmitterObject : public Object {
 public:
  static constexpr size_t kEvents = sizeof...(Fns);

  template <size_t I>
  using Listener = std::tuple_element_t<I, std::tuple<Fns...>>;

  explicit EventEmitterObject(std::vector<std::string> names) : names_(std::move(names)) {}

  static Ref<EventEmitterObject> create(std::initializer_list<const char*> names) {
    std::vector<std::string> list;
    for (const char* n : names) list.emplace_back(n);
    return std::make_shared<EventEmitterObject>(std::move(list));
  }

  const std::vector<std::string>& names() const { return names_; }

  /// The index of the event `name`, or kEvents when it has none.
  size_t indexOf(const std::string& name) const {
    for (size_t i = 0; i < names_.size(); i++)
      if (names_[i] == name) return i;
    return kEvents;
  }

  /// Adds `fn` as the last listener of event I. `alive`, when given, says
  /// whether the listener's owner still is (a JavaScript runtime).
  template <size_t I>
  EventSubscription addListener(Listener<I> fn, std::function<bool()> alive = nullptr) {
    uint64_t id = nextId_++;
    std::get<I>(listeners_).push_back(Entry<Listener<I>>{id, std::move(fn), std::move(alive)});
    auto weak = std::weak_ptr<Object>(this->shared_from_this());
    return std::make_shared<EventSubscriptionObject>([weak, id] {
      auto self = weak.lock();
      if (!self) return;
      auto& list = std::get<I>(static_cast<EventEmitterObject&>(*self).listeners_);
      for (auto it = list.begin(); it != list.end(); ++it)
        if (it->id == id) {
          list.erase(it);
          return;
        }
    });
  }

  /// Calls event I's listeners, those it has now, in the order they were
  /// added. A listener's throw ends the emit and reaches its caller.
  template <size_t I, class... A>
  void emit(A... args) {
    prune(std::get<I>(listeners_));
    auto now = std::get<I>(listeners_);
    for (auto& l : now) {
      if (l.alive && !l.alive()) continue;
      l.fn(args...);
    }
  }

  /// How many listeners event `i` has.
  double listenerCount(size_t i) {
    double n = 0;
    detail::withIndex<kEvents>(i, [&](auto I) {
      auto& list = std::get<I>(listeners_);
      prune(list);
      n = static_cast<double>(list.size());
    });
    return n;
  }

  /// Removes event `i`'s listeners.
  void removeAllListeners(size_t i) {
    detail::withIndex<kEvents>(i, [&](auto I) { std::get<I>(listeners_).clear(); });
  }

  /// Removes every event's listeners.
  void removeAllListeners() {
    std::apply([](auto&... list) { (list.clear(), ...); }, listeners_);
  }

 private:
  template <class F>
  struct Entry {
    uint64_t id;
    F fn;
    std::function<bool()> alive;
  };

  /// Drops the listeners whose owner is gone.
  template <class List>
  static void prune(List& list) {
    std::erase_if(list, [](const auto& l) { return l.alive && !l.alive(); });
  }

  std::vector<std::string> names_;
  std::tuple<std::vector<Entry<Fns>>...> listeners_;
  uint64_t nextId_ = 1;
};

}  // namespace lucent
