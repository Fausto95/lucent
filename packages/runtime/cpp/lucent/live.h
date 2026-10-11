// Lucent runtime — how many of each thing the runtime owns are alive, for
// what a debug build reports (debug.h). A class counts its instances by
// holding a live::Counted member: counted in when made, out when gone.
// Relaxed atomics: a count, never a synchronization.
#pragma once

#include <array>
#include <atomic>
#include <cstddef>

namespace lucent::live {

enum class Kind : std::size_t { Scope, Operation, Resource, Effect, Signal, Computed, Count };

namespace detail {
// Constant-initialized: safe to count during static initialization.
inline std::array<std::atomic<long>, static_cast<std::size_t>(Kind::Count)> counts{};
}  // namespace detail

/// How many of `kind` are alive now.
inline long count(Kind kind) noexcept {
  return detail::counts[static_cast<std::size_t>(kind)].load(std::memory_order_relaxed);
}

/// A member counting the object holding it.
template <Kind K>
struct Counted {
  Counted() noexcept { add(1); }
  Counted(const Counted&) noexcept { add(1); }
  Counted& operator=(const Counted&) noexcept = default;
  ~Counted() { add(-1); }

 private:
  static void add(long n) noexcept {
    detail::counts[static_cast<std::size_t>(K)].fetch_add(n, std::memory_order_relaxed);
  }
};

#ifndef NDEBUG
/// Debug builds: on this thread, how many things still open their last
/// reference closed (a Resource, a native buffer's storage), the backstop
/// rather than the close their owner should have made. A host reads it
/// around releasing an instance JavaScript let go of (jsi/host.cpp).
inline thread_local long backstops = 0;

inline void noteBackstop() noexcept { ++backstops; }
#else
inline void noteBackstop() noexcept {}
#endif

}  // namespace lucent::live
