#include "buffer.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "report.h"
#include "trace.h"

namespace lucent {

namespace {

struct Counters {
  std::atomic<uint64_t> allocated{0};
  std::atomic<uint64_t> adopted{0};
  std::atomic<uint64_t> released{0};
  std::atomic<uint64_t> transfers{0};
  std::atomic<uint64_t> copies{0};
  std::atomic<uint64_t> bytesCopied{0};
};

// Constant-initialized: usable during static initialization.
Counters counters;

void countCopy(size_t bytes) {
  counters.copies.fetch_add(1, std::memory_order_relaxed);
  counters.bytesCopied.fetch_add(bytes, std::memory_order_relaxed);

  trace::instant(trace::Category::Copy, "buffer.copy", {.parent = trace::currentId(), .value = static_cast<int64_t>(bytes)});
}

void freeAllocated(uint8_t* data, size_t) { delete[] data; }

}  // namespace

NativeBuffer NativeBufferObject::allocate(double size, String origin) {
  if (!(size >= 0) || std::trunc(size) != size || size > 9007199254740991.0) throwRangeError("Invalid buffer size");

  auto count = static_cast<size_t>(size);
  auto* data = new uint8_t[count]();

  counters.allocated.fetch_add(1, std::memory_order_relaxed);
  trace::instant(trace::Category::Alloc, "buffer.allocate", {.parent = trace::currentId(), .value = static_cast<int64_t>(count)});
  return NativeBuffer(new NativeBufferObject(data, count, freeAllocated, nullptr, std::move(origin), 0));
}

NativeBuffer NativeBufferObject::adopt(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* destroyOn,
                                       String origin) {
  counters.adopted.fetch_add(1, std::memory_order_relaxed);
  trace::instant(trace::Category::Alloc, "buffer.adopt", {.parent = trace::currentId(), .value = static_cast<int64_t>(size)});
  return NativeBuffer(new NativeBufferObject(data, size, std::move(destroy), destroyOn, std::move(origin), 0));
}

NativeBuffer NativeBufferObject::fromBytes(const Bytes& bytes, String origin) {
  NativeBuffer buffer = allocate(static_cast<double>(bytes.size()), std::move(origin));

  if (bytes.size() > 0) std::memcpy(buffer->data_, bytes.data(), bytes.size());
  countCopy(bytes.size());

  return buffer;
}

NativeBufferObject::NativeBufferObject(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* destroyOn,
                                       String origin, uint32_t generation)
    : data_(data),
      size_(size),
      destroy_(std::move(destroy)),
      destroyOn_(destroyOn),
      origin_(std::move(origin)),
      generation_(generation) {}

NativeBufferObject::~NativeBufferObject() {
  // Nothing refers to it any more: nothing borrows it or changes its state.
  if (state() != State::Open) return;

  try {
    release(data_, size_.load(std::memory_order_relaxed), std::move(destroy_), destroyOn_);
  } catch (...) {
    reportUncaught(std::current_exception(), "native buffer");
  }
}

NativeBufferStats NativeBufferObject::stats() {
  NativeBufferStats s;
  s.allocated = counters.allocated.load(std::memory_order_relaxed);
  s.adopted = counters.adopted.load(std::memory_order_relaxed);
  s.released = counters.released.load(std::memory_order_relaxed);
  s.transfers = counters.transfers.load(std::memory_order_relaxed);
  s.copies = counters.copies.load(std::memory_order_relaxed);
  s.bytesCopied = counters.bytesCopied.load(std::memory_order_relaxed);
  return s;
}

Bytes NativeBufferObject::toBytes() {
  return withRead([](std::span<const uint8_t> bytes) { return copyOut(bytes); });
}

Bytes NativeBufferObject::copyOut(std::span<const uint8_t> bytes) {
  countCopy(bytes.size());
  return Bytes::copy(bytes.data(), bytes.size());
}

void NativeBufferObject::copyIn(std::span<uint8_t> to, const Bytes& from) {
  size_t count = std::min(to.size(), from.size());

  if (count > 0) std::memcpy(to.data(), from.data(), count);
  countCopy(count);
}

bool NativeBufferObject::close() {
  uint32_t expected = 0;

  if (!word_.compare_exchange_strong(expected, static_cast<uint32_t>(State::Closed), std::memory_order_acq_rel)) {
    State now = stateOf(expected);
    if (now == State::Closed || now == State::Transferred) return false;

    refuse(expected);
  }

  uint8_t* data = data_;
  size_t size = size_.exchange(0, std::memory_order_acq_rel);
  Destroy destroy = std::move(destroy_);
  data_ = nullptr;
  destroy_ = nullptr;

  release(data, size, std::move(destroy), destroyOn_);
  return true;
}

NativeBuffer NativeBufferObject::transfer() {
  NativeBuffer moved = beginTransfer();
  commitTransfer();
  return moved;
}

NativeBuffer NativeBufferObject::beginTransfer() {
  seize(State::Transferring);

  NativeBuffer moved(new NativeBufferObject(data_, size_.exchange(0, std::memory_order_acq_rel), std::move(destroy_),
                                            destroyOn_, origin_, generation_ + 1));
  data_ = nullptr;
  destroy_ = nullptr;

  return moved;
}

void NativeBufferObject::commitTransfer() {
  word_.store(static_cast<uint32_t>(State::Transferred), std::memory_order_release);
  counters.transfers.fetch_add(1, std::memory_order_relaxed);
}

void NativeBufferObject::abortTransfer(const NativeBuffer& successor) {
  // The successor never left the failed copy: nothing borrows it.
  data_ = successor->data_;
  size_.store(successor->size_.exchange(0, std::memory_order_acq_rel), std::memory_order_relaxed);
  destroy_ = std::move(successor->destroy_);

  successor->data_ = nullptr;
  successor->destroy_ = nullptr;
  successor->word_.store(static_cast<uint32_t>(State::Transferred), std::memory_order_relaxed);

  word_.store(0, std::memory_order_release);
}

void NativeBufferObject::release(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* on) {
  counters.released.fetch_add(1, std::memory_order_relaxed);

  if (!destroy) return;

  detail::runOn(on, [data, size, destroy = std::move(destroy)] { destroy(data, size); });
}

void NativeBufferObject::seize(State to) {
  uint32_t expected = 0;
  if (!word_.compare_exchange_strong(expected, static_cast<uint32_t>(to), std::memory_order_acq_rel)) refuse(expected);
}

void NativeBufferObject::refuse(uint32_t word) const {
  const char* why = "is borrowed";

  switch (stateOf(word)) {
    case State::Open:
      break;
    case State::Transferring:
      why = "is being transferred";
      break;
    case State::Transferred:
      why = "was transferred";
      break;
    case State::Closed:
      why = "is closed";
      break;
  }

  String name = origin_.empty() ? String::fromLatin1("NativeBuffer")
                                : String::fromLatin1("NativeBuffer (") + origin_ + String::fromLatin1(")");
  throwError(String::fromLatin1("InvalidStateError"), name + String::fromLatin1(" ") + String::fromLatin1(why));
}

// --- Borrow ---------------------------------------------------------------------

NativeBufferObject::Borrow::Borrow(NativeBufferObject& buffer, bool write)
    : keep_(buffer.shared_from_this()), buffer_(buffer), write_(write) {
  std::atomic<uint32_t>& word = buffer.word_;

  if (write) {
    uint32_t expected = 0;
    if (!word.compare_exchange_strong(expected, kWriter, std::memory_order_acquire)) buffer.refuse(expected);

    return;
  }

  uint32_t now = word.load(std::memory_order_relaxed);
  do {
    if (stateOf(now) != State::Open || (now & kWriter)) buffer.refuse(now);
  } while (!word.compare_exchange_weak(now, now + kReader, std::memory_order_acquire, std::memory_order_relaxed));
}

NativeBufferObject::Borrow::~Borrow() {
  if (write_) {
    buffer_.word_.fetch_and(~kWriter, std::memory_order_release);
  } else {
    buffer_.word_.fetch_sub(kReader, std::memory_order_release);
  }
}

}  // namespace lucent
