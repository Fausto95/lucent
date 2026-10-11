// Lucent runtime — lucent:core's EventEmitter.
//
// An emitter keeps each event's listeners, in the order they were added,
// and calls them when it emits. Generated code names an event by its index
// in the emitter's type (the compiler knows each name's); JavaScript names
// it by string, which the instance keeps.
//
// A listener JavaScript added belongs to its runtime: once that runtime's
// host is torn down (a reload), the listener is gone, and listenerCount no
// longer counts it. Everything here runs in the actor of the module that
// made the emitter (or its subscription): JavaScript's calls enter it too.
//
// onObserved tells module code when an event gets its first listener and
// when its last goes, from either side, to start and stop what feeds it.
#pragma once

#include <array>
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
#include "json.h"
#include "jsstring.h"
#include "scheduler.h"

namespace lucent {

/// What addListener returns: remove() takes the listener off, once.
class EventSubscriptionObject : public Object {
 public:
  explicit EventSubscriptionObject(std::function<void()> remove) : remove_(std::move(remove)) {}

  /// The actor it was made in: its emitter's, which remove() enters.
  Actor& actor() const { return actor_ ? *actor_ : Actor::shared(); }

  /// Removes the listener; again, does nothing.
  void remove() {
    if (auto f = std::exchange(remove_, nullptr)) f();
  }

 private:
  std::function<void()> remove_;
  Actor* actor_ = Actor::current();
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

  /// The actor of the module that made it, whose code its listeners and
  /// emits run in; JavaScript's calls enter it too.
  Actor& actor() const { return actor_ ? *actor_ : Actor::shared(); }

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
  /// whether the listener's owner still is (a JavaScript runtime). `id`,
  /// when given, receives the listener's, for removeListener.
  template <size_t I>
  EventSubscription addListener(Listener<I> fn, std::function<bool()> alive = nullptr, uint64_t* id = nullptr) {
    uint64_t at = nextId_++;
    if (id) *id = at;
    prune<I>();
    auto& list = std::get<I>(listeners_);
    bool first = list.empty();
    list.push_back(Entry<Listener<I>>{at, std::move(fn), std::move(alive)});
    auto weak = std::weak_ptr<Object>(this->shared_from_this());
    auto subscription = std::make_shared<EventSubscriptionObject>([weak, at] {
      if (auto self = weak.lock()) static_cast<EventEmitterObject&>(*self).template removeListener<I>(at);
    });
    if (first) observed(I, true);
    return subscription;
  }

  /// Removes event I's listener `id`, if it still has it.
  template <size_t I>
  void removeListener(uint64_t id) {
    auto& list = std::get<I>(listeners_);
    for (auto it = list.begin(); it != list.end(); ++it)
      if (it->id == id) {
        list.erase(it);
        if (list.empty()) observed(I, false);
        return;
      }
  }

  /// Calls event I's listeners, those it has now, in the order they were
  /// added. A listener's throw ends the emit and reaches its caller.
  template <size_t I, class... A>
  void emit(A... args) {
    prune<I>();
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
      prune<decltype(I)::value>();
      n = static_cast<double>(std::get<I>(listeners_).size());
    });
    return n;
  }

  /// Removes event `i`'s listeners.
  void removeAllListeners(size_t i) {
    detail::withIndex<kEvents>(i, [&](auto I) { clear<decltype(I)::value>(); });
  }

  /// Removes every event's listeners, event by event in declaration order.
  void removeAllListeners() {
    clearAll(std::make_index_sequence<kEvents>{});
  }

  /// Calls `observer(true)` when event `i` gets its first listener, from
  /// Lucent or JavaScript, and `observer(false)` when its last goes
  /// (removed, or its runtime torn down); at once with true when it has
  /// listeners now. The subscription stops it.
  EventSubscription onObserved(size_t i, Fn<void(bool)> observer) {
    uint64_t at = nextId_++;
    observers_.at(i).push_back(Observer{at, observer});
    auto weak = std::weak_ptr<Object>(this->shared_from_this());
    auto subscription = std::make_shared<EventSubscriptionObject>([weak, i, at] {
      auto self = weak.lock();
      if (!self) return;
      auto& list = static_cast<EventEmitterObject&>(*self).observers_.at(i);
      std::erase_if(list, [at](const Observer& o) { return o.id == at; });
    });
    if (listenerCount(i) > 0) observer(true);
    return subscription;
  }

 private:
  template <class F>
  struct Entry {
    uint64_t id;
    F fn;
    std::function<bool()> alive;
  };

  struct Observer {
    uint64_t id;
    Fn<void(bool)> fn;
  };

  /// Drops event I's listeners whose owner is gone.
  template <size_t I>
  void prune() {
    auto& list = std::get<I>(listeners_);
    bool had = !list.empty();
    std::erase_if(list, [](const auto& l) { return l.alive && !l.alive(); });
    if (had && list.empty()) observed(I, false);
  }

  template <size_t... I>
  void clearAll(std::index_sequence<I...>) {
    (clear<I>(), ...);
  }

  template <size_t I>
  void clear() {
    auto& list = std::get<I>(listeners_);
    bool had = !list.empty();
    list.clear();
    if (had) observed(I, false);
  }

  /// Tells event `i`'s observers, those it has now, in the order they were added.
  void observed(size_t i, bool on) {
    if (observers_[i].empty()) return;
    auto now = observers_[i];
    for (auto& o : now) o.fn(on);
  }

  Actor* actor_ = Actor::current();
  std::vector<std::string> names_;
  std::tuple<std::vector<Entry<Fns>>...> listeners_;
  std::array<std::vector<Observer>, kEvents> observers_;
  uint64_t nextId_ = 1;
};

/// An emitter and a subscription have no enumerable own properties.
template <class... Fns>
void jsonWrite(JsonWriter& w, const Ref<EventEmitterObject<Fns...>>&) {
  w.raw("{}");
}
inline void jsonWrite(JsonWriter& w, const EventSubscription&) { w.raw("{}"); }

}  // namespace lucent
