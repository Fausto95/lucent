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
#include <type_traits>
#include <utility>
#include <vector>

#include "async.h"
#include "buffer.h"
#include "core.h"
#include "report.h"
#include "scope.h"

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
    std::optional<T> dropped;
    std::optional<Promise<Opt<T>>> waiter;
    {
      std::lock_guard<std::mutex> g(m_);
      if (closed_) {
        stats_.refused++;
        return false;
      }

      if (!waiters_.empty()) {
        waiter.emplace(std::move(waiters_.front()));
        waiters_.pop_front();
        stats_.received++;
      } else if (queue_.size() < capacity_) {
        queue_.push_back(std::move(value));
      } else if (policy_ == ChannelPolicy::Lossless) {
        stats_.refused++;
        return false;
      } else {
        dropped.emplace(std::move(queue_.front()));
        queue_.pop_front();
        queue_.push_back(std::move(value));
        stats_.dropped++;
      }

      stats_.sent++;
      if (queue_.size() > stats_.highWater) stats_.highWater = queue_.size();
    }

    if (dropped) detail::releaseUnreceived(*dropped);
    if (waiter) waiter->resolve(Opt<T>(std::move(value)));
    return true;
  }

  /// The next value, settled on the calling context: at once if one is
  /// queued, else when one is sent; undefined once closed and drained.
  Promise<Opt<T>> receive() {
    std::lock_guard<std::mutex> g(m_);
    if (!queue_.empty()) {
      T value = std::move(queue_.front());
      queue_.pop_front();
      stats_.received++;
      return Promise<Opt<T>>::resolved(Opt<T>(std::move(value)));
    }

    if (closed_) return Promise<Opt<T>>::resolved(Opt<T>(undefined));

    Promise<Opt<T>> next;
    waiters_.push_back(next);
    return next;
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

  /// The scope's disposal: closes it and releases what was never received.
  void releaseAll() {
    std::deque<T> left;
    std::deque<Promise<Opt<T>>> waiting;
    {
      std::lock_guard<std::mutex> g(m_);
      closed_ = true;
      left.swap(queue_);
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
  std::deque<Promise<Opt<T>>> waiters_;
  bool closed_ = false;
  ChannelStats stats_;

  std::weak_ptr<Scope> scope_;
  std::atomic<Scope::CleanupId> cleanup_{0};
};

/// lucent:core's Channel<T>.
template <class T>
using Channel = Ref<ChannelObject<T>>;

}  // namespace lucent
