#include "handle.h"

#include <exception>
#include <stdexcept>
#include <utility>

#include "live.h"
#include "report.h"

namespace lucent {

Ref<NativeHandleObject> NativeHandleObject::make(void* pointer, Release release, String kind) {
  if (!pointer) throw std::invalid_argument("A native handle's pointer is not null");
  if (!release) throw std::invalid_argument("A native handle's release must be a function");

  return Ref<NativeHandleObject>(new NativeHandleObject(pointer, std::move(release), std::move(kind)));
}

NativeHandleObject::NativeHandleObject(void* pointer, Release release, String kind)
    : pointer_(reinterpret_cast<uintptr_t>(pointer)), release_(std::move(release)), kind_(std::move(kind)) {}

NativeHandleObject::~NativeHandleObject() {
  // Nothing else refers to it: nothing releases it concurrently.
  if (!release_) return;

  live::noteBackstop();
  pointer_.store(0, std::memory_order_release);
  try {
    std::exchange(release_, nullptr)();
  } catch (...) {
    reportUncaught(std::current_exception(), "native handle");
  }
}

bool NativeHandleObject::release() {
  Release release;
  {
    std::lock_guard<std::mutex> g(m_);
    if (!release_) return false;
    release = std::exchange(release_, nullptr);
    pointer_.store(0, std::memory_order_release);
  }

  release();
  return true;
}

}  // namespace lucent
