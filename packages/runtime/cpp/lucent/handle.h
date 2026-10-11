// Lucent runtime — native handles (T73): an address other native code
// takes, and what keeps it valid until released.
//
// A handle is what VisionCamera's `NativeBuffer` is to Skia: a pointer
// (`pointer`, a bigint in JavaScript) and a `release()`. What it points to
// stays valid while the handle is held: a native buffer's handle borrows
// its bytes (reads go on; writes, transfers and closing refuse) until it is
// released. Release runs once, from Lucent or JavaScript, on any thread;
// a handle whose last reference goes unreleased is released then, the
// backstop a debug build counts (live::noteBackstop, Host::Ownership's
// releasedOpen when JavaScript dropped it).
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>

#include "core.h"
#include "jsstring.h"

namespace lucent {

class NativeHandleObject final : public Object {
 public:
  /// What releases the handle's hold; runs once.
  using Release = std::function<void()>;

  /// A handle of `pointer` (not null), naming what it points to in
  /// errors and reports: "NativeBuffer bytes", "CVPixelBuffer".
  static Ref<NativeHandleObject> make(void* pointer, Release release, String kind);

  /// Releases it if still held: the backstop.
  ~NativeHandleObject() override;

  NativeHandleObject(const NativeHandleObject&) = delete;
  NativeHandleObject& operator=(const NativeHandleObject&) = delete;

  /// The address while held; 0 once released.
  uint64_t pointer() const { return pointer_.load(std::memory_order_acquire); }

  bool released() const { return pointer() == 0; }

  const String& kind() const { return kind_; }

  /// Any thread, idempotent: the first call releases it and returns true.
  /// An error from the release reaches the caller.
  bool release();

 private:
  NativeHandleObject(void* pointer, Release release, String kind);

  std::atomic<uint64_t> pointer_;
  std::mutex m_;
  Release release_;
  const String kind_;
};

using NativeHandle = Ref<NativeHandleObject>;

/// As JavaScript shows an object.
inline String toJsString(const NativeHandle&) { return String::fromLatin1("[object Object]"); }

}  // namespace lucent
