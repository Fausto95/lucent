// Lucent runtime — channels: values from a producer on any thread to a
// consumer on its own context, under a policy for when the consumer falls
// behind (T74).
//
// A producer never waits: a send returns at once, whatever the consumer
// is doing, so a callback on a thread of its own (a camera's frames, an
// audio block) never queues behind module code. What happens to a value
// the consumer has no room for is the channel's policy:
//
// - lossless: bounded; a send into a full channel is refused (false), and
//   the value stays the producer's.
// - latest: one slot; a send replaces the value waiting there.
// - drop: bounded; a send into a full channel drops the oldest value.
//
// A value a policy drops is released at once: a NativeBuffer is closed,
// once. The consumer receives on its own context: a value already queued
// at once, else the next one sent, posted there. Closing the channel
// refuses sends from then on; the consumer still receives what was
// queued, then undefined. The disposal of the scope it belongs to (which
// refers to it weakly), or its last reference going, closes it and
// releases what was never received.
#pragma once

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <exception>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "async.h"
#include "buffer.h"
#include "core.h"
#include "events.h"
#include "execution.h"
#include "json.h"
#include "jsstring.h"
#include "report.h"
#include "scope.h"
#include "trace.h"
#include "transport.h"

namespace lucent {

enum class ChannelPolicy : uint8_t { Lossless, Latest, Drop };

/// What a channel has done since it was made, and holds now.
struct ChannelStats {
  /// Values it took.
  uint64_t sent = 0;
  /// Values the consumer received.
  uint64_t received = 0;
  /// Values released unreceived: dropped by the policy, or left at the
  /// scope's disposal or the channel's end.
  uint64_t dropped = 0;
  /// Sends refused: into a full lossless channel, or a closed one.
  uint64_t refused = 0;
  /// Values waiting now, and the most that ever waited.
  size_t depth = 0;
  size_t highWater = 0;
};

namespace detail {

/// Releases a value no consumer will receive: closes a native buffer.
template <class T>
void releaseUnreceived(T& value) noexcept {
  if constexpr (std::is_same_v<T, NativeBuffer>) {
    if (!value) return;
    try {
      value->close();
    } catch (...) {
      reportUncaught(std::current_exception(), "channel");
    }
  }
}

}  // namespace detail

template <class T>
class ChannelObject final : public Object {
 public:
  /// `capacity`: a whole number from 1, and 1 for latest (a RangeError
  /// otherwise). Under a scope no longer active, it is closed at once.
  static Ref<ChannelObject> create(ChannelPolicy policy, double capacity, const std::shared_ptr<Scope>& scope = nullptr) {
    if (!(capacity >= 1) || capacity != std::floor(capacity) || capacity > 1e9)
      throwRangeError("A channel's capacity must be a whole number from 1");
    if (policy == ChannelPolicy::Latest && capacity != 1) throwRangeError("A latest channel holds one value: its capacity is 1");

    Ref<ChannelObject> channel(new ChannelObject(policy, static_cast<size_t>(capacity)));
    if (!scope) return channel;

    channel->scope_ = scope;
    std::weak_ptr<ChannelObject> weak = channel;
    // Runs now if the scope is no longer active; see Resource::open on a
    // disposal racing the id's store.
    Scope::CleanupId id = scope->onDispose([weak] {
      if (auto c = weak.lock()) c->releaseAll();
    });
    channel->cleanup_.store(id);

    return channel;
  }

  ~ChannelObject() override {
    if (auto scope = scope_.lock()) scope->remove(cleanup_.load());
    for (auto& v : queue_) detail::releaseUnreceived(v);
    for (auto& w : waiters_) w.resolve(Opt<T>(undefined));
  }

  ChannelObject(const ChannelObject&) = delete;
  ChannelObject& operator=(const ChannelObject&) = delete;

  ChannelPolicy policy() const { return policy_; }
  size_t capacity() const { return capacity_; }

  /// Any thread; never waits. False if refused: the channel is closed, or
  /// lossless and full. A waiting receive gets the value at once, on its
  /// context.
  bool send(T value) {
    return sendWith([&]() -> T { return std::move(value); });
  }

  /// What Lucent code's send does: as send(), with a copy of `value` made
  /// as a compute task's input is (transport.h), a native buffer moved;
  /// refused, it copies and moves nothing. A copy that throws (a
  /// DataCloneError) sends nothing.
  bool sendCopy(const T& value)
    requires Transportable<T>
  {
    return sendWith([&]() -> T { return transportCopy(value); });
  }

  /// The next value, settled on the calling context: at once if one is
  /// queued, else when one is sent; undefined once closed and drained.
  Promise<Opt<T>> receive() {
    std::unique_lock<std::mutex> g(m_);
    if (!queue_.empty()) {
      T value = std::move(queue_.front());
      queue_.pop_front();
      const uint64_t sentAt = sentAt_.front();
      sentAt_.pop_front();
      stats_.received++;
      const size_t depth = queue_.size();
      g.unlock();

      if (sentAt && trace::enabled()) [[unlikely]] {
        trace::span(trace::Category::Queue, "channel.wait", sentAt, trace::now(), {.id = traceId_});
        trace::counter("channel.depth", static_cast<int64_t>(depth), traceId_);
      }
      return Promise<Opt<T>>::resolved(Opt<T>(std::move(value)));
    }

    if (closed_) return Promise<Opt<T>>::resolved(Opt<T>(undefined));

    Promise<Opt<T>> next;
    waiters_.push_back(next);
    return next;
  }

  /// Calls `onValue` with each value, on the calling context, one at a
  /// time as they come: the next is received once it returns, so the
  /// channel's policy still decides what waits meanwhile. Until the channel
  /// is closed and drained, or gone, or the subscription is removed. A
  /// value `onValue` throws on is reported, and the next one comes.
  EventSubscription subscribe(Fn<void(T)> onValue);

  /// Forgets a receive still waiting (a removed subscription's).
  void forget(const Promise<Opt<T>>& waiting) {
    std::lock_guard<std::mutex> g(m_);
    std::erase_if(waiters_, [&](const Promise<Opt<T>>& w) { return w.identity() == waiting.identity(); });
  }

  /// Any thread. The first call closes it and returns true: sends are
  /// refused from then on, and receives get what is queued, then
  /// undefined.
  bool close() {
    std::deque<Promise<Opt<T>>> waiting;
    {
      std::lock_guard<std::mutex> g(m_);
      if (closed_) return false;
      closed_ = true;
      // Receives wait only while nothing is queued.
      waiting.swap(waiters_);
    }

    for (auto& w : waiting) w.resolve(Opt<T>(undefined));
    return true;
  }

  bool closed() const {
    std::lock_guard<std::mutex> g(m_);
    return closed_;
  }

  ChannelStats stats() const {
    std::lock_guard<std::mutex> g(m_);
    ChannelStats s = stats_;
    s.depth = queue_.size();
    return s;
  }

 private:
  ChannelObject(ChannelPolicy policy, size_t capacity) : policy_(policy), capacity_(capacity) {}

  /// Takes `make()`'s value if the channel accepts one: `make` runs only
  /// then, under the channel's lock, so a refused send leaves its value.
  template <class Make>
  bool sendWith(Make&& make) {
    std::optional<T> dropped;
    std::optional<Promise<Opt<T>>> waiter;
    std::optional<T> handed;
    // What a trace records, once the lock is let go: the depth after the send, the totals.
    const bool tracing = trace::enabled();
    size_t depth = 0;
    uint64_t refused = 0;
    uint64_t drops = 0;
    {
      std::lock_guard<std::mutex> g(m_);
      if (closed_) {
        refused = ++stats_.refused;
      } else if (waiters_.empty() && queue_.size() >= capacity_ && policy_ == ChannelPolicy::Lossless) {
        refused = ++stats_.refused;
      } else {
        const bool full = waiters_.empty() && queue_.size() >= capacity_;
        T value = make();
        if (!waiters_.empty()) {
          waiter.emplace(std::move(waiters_.front()));
          waiters_.pop_front();
          handed.emplace(std::move(value));
          stats_.received++;
        } else {
          if (full) {
            dropped.emplace(std::move(queue_.front()));
            queue_.pop_front();
            sentAt_.pop_front();
            drops = ++stats_.dropped;
          }
          queue_.push_back(std::move(value));
          // When it was sent, for the trace's wait from send to receive (0: untraced).
          sentAt_.push_back(tracing ? trace::now() : 0);
        }

        stats_.sent++;
        if (queue_.size() > stats_.highWater) stats_.highWater = queue_.size();
        depth = queue_.size();
      }
    }

    if (tracing) [[unlikely]] {
      if (refused) trace::instant(trace::Category::Queue, "channel.refused", {.id = traceId_, .value = static_cast<int64_t>(refused)});
      if (drops) trace::instant(trace::Category::Queue, "channel.dropped", {.id = traceId_, .value = static_cast<int64_t>(drops)});
      if (!refused) trace::counter("channel.depth", static_cast<int64_t>(depth), traceId_);
    }
    if (refused) return false;

    if (dropped) detail::releaseUnreceived(*dropped);
    if (waiter) waiter->resolve(Opt<T>(std::move(*handed)));
    return true;
  }

  /// The scope's disposal: closes it and releases what was never received.
  void releaseAll() {
    std::deque<T> left;
    std::deque<Promise<Opt<T>>> waiting;
    {
      std::lock_guard<std::mutex> g(m_);
      closed_ = true;
      left.swap(queue_);
      sentAt_.clear();
      waiting.swap(waiters_);
      stats_.dropped += left.size();
    }

    for (auto& v : left) detail::releaseUnreceived(v);
    for (auto& w : waiting) w.resolve(Opt<T>(undefined));
  }

  const ChannelPolicy policy_;
  const size_t capacity_;

  mutable std::mutex m_;
  std::deque<T> queue_;
  /// When each queued value was sent, on the trace clock (0: not traced).
  std::deque<uint64_t> sentAt_;
  /// Its events' id in a trace: its depth is a series of its own.
  const uint64_t traceId_ = trace::newId();
  std::deque<Promise<Opt<T>>> waiters_;
  bool closed_ = false;
  ChannelStats stats_;

  std::weak_ptr<Scope> scope_;
  std::atomic<Scope::CleanupId> cleanup_{0};
};

/// lucent:core's Channel<T>.
template <class T>
using Channel = Ref<ChannelObject<T>>;

template <class T>
EventSubscription ChannelObject<T>::subscribe(Fn<void(T)> onValue) {
  // Receives one value at a time; holds the channel weakly, so a channel
  // nothing else holds goes (and settles the waiting receive).
  struct Pump : std::enable_shared_from_this<Pump> {
    std::weak_ptr<ChannelObject> channel;
    Fn<void(T)> fn;
    bool active = true;
    std::optional<Promise<Opt<T>>> waiting;

    void next() {
      auto c = channel.lock();
      if (!c || !active) return;

      Promise<Opt<T>> p = c->receive();
      waiting = p;
      p.onSettled([self = this->shared_from_this(), p] {
        self->waiting.reset();
        if (!p.fulfilled() || !p.value().has()) return;

        T value = p.value().get();
        if (!self->active) {
          detail::releaseUnreceived(value);
          return;
        }

        try {
          self->fn(std::move(value));
        } catch (...) {
          reportUncaught(std::current_exception(), "channel subscriber");
        }
        self->next();
      });
    }
  };

  auto pump = std::make_shared<Pump>();
  pump->channel = std::static_pointer_cast<ChannelObject>(this->shared_from_this());
  pump->fn = std::move(onValue);
  pump->next();

  return std::make_shared<EventSubscriptionObject>([pump] {
    pump->active = false;
    if (!pump->waiting) return;
    // Its waiting receive gets no value now; settled, it lets the pump go.
    Promise<Opt<T>> waiting = *std::exchange(pump->waiting, std::nullopt);
    if (auto c = pump->channel.lock()) c->forget(waiting);
    waiting.resolve(Opt<T>(undefined));
  });
}

/// A policy by the name Lucent code gives it: a TypeError for another.
inline ChannelPolicy channelPolicy(const String& name) {
  const std::string n = name.toUtf8();
  if (n == "lossless") return ChannelPolicy::Lossless;
  if (n == "latest") return ChannelPolicy::Latest;
  if (n == "drop") return ChannelPolicy::Drop;
  throwTypeError("A channel's policy is lossless, latest or drop");
}

/// `new Channel<T>(policy, capacity?)`: 16 values by default, a latest
/// channel's one, under the scope the calling context's work belongs to
/// (module code's ends with its JavaScript runtime).
template <class T>
Channel<T> makeChannel(const String& policy, const Opt<double>& capacity) {
  const ChannelPolicy p = channelPolicy(policy);
  const double n = capacity.has() ? capacity.get() : p == ChannelPolicy::Latest ? 1 : 16;
  return ChannelObject<T>::create(p, n, ownedScope(ExecutionContext::currentRef()));
}

/// A channel has no enumerable own properties: JSON writes it as `{}`.
template <class T>
void jsonWrite(JsonWriter& w, const Channel<T>&) {
  w.raw("{}");
}

/// A channel crosses to a compute task as itself: both ends share it, and
/// what crosses through it is copied by its sends.
template <class T>
struct Transport<Channel<T>> {
  static Channel<T> copy(const Channel<T>& channel, CopyGraph&) { return channel; }
};

}  // namespace lucent
