// Lucent runtime — what the renderer made for each view, found again by
// the view's surface and tag.
//
// The Android host never gets a view's event emitter from Java: its
// descriptor records each one as the renderer makes it (HostDescriptor),
// and the host finds it when the view mounts. A tag alone does not name a
// view: each JavaScript runtime numbers its views again, so across a reload
// an old surface's view and a new one's share tags. Surfaces are numbered
// for the process, so the two together do.
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <utility>

namespace lucent::views {

/** Per view, by surface and tag, what the renderer made: held weakly. Any thread. */
template <class T>
class ViewRegistry {
 public:
  /// `value` is what the renderer made for view `tag` of `surface`, from now on.
  void record(int32_t surface, int32_t tag, const std::shared_ptr<T>& value) {
    std::lock_guard<std::mutex> g(mutex_);

    // Views gone since leave expired entries: dropped whenever the registry has doubled.
    if (entries_.size() > limit_) {
      std::erase_if(entries_, [](const auto& entry) { return entry.second.expired(); });
      limit_ = std::max(kFloor, 2 * entries_.size());
    }

    entries_[{surface, tag}] = value;
  }

  /// What the renderer made for view `tag` of `surface`, or null (none, or gone).
  std::shared_ptr<T> find(int32_t surface, int32_t tag) const {
    std::lock_guard<std::mutex> g(mutex_);
    auto found = entries_.find({surface, tag});

    return found == entries_.end() ? nullptr : found->second.lock();
  }

  /// How many entries it holds, gone ones included until pruned.
  std::size_t size() const {
    std::lock_guard<std::mutex> g(mutex_);

    return entries_.size();
  }

 private:
  static constexpr std::size_t kFloor = 256;

  mutable std::mutex mutex_;
  std::map<std::pair<int32_t, int32_t>, std::weak_ptr<T>> entries_;
  std::size_t limit_ = kFloor;
};

}  // namespace lucent::views
