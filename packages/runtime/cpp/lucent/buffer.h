// Lucent runtime — native buffers.
//
// A NativeBuffer is bytes that native code owns: allocated by the runtime,
// or adopted from native code with the release it requires and the
// executor that release must run on. Its handle is reference counted, but a
// reference keeps only the handle alive: access to the bytes is a borrow,
// granted for the length of one synchronous call. Read borrows share;
// a write borrow excludes every other. A borrow that conflicts is refused at
// once with an InvalidStateError, never waited for, whatever thread asks.
//
// The storage is released once: at close(), which a borrow refuses, or when
// the last reference goes, on the executor it requires. After that every
// alias refuses access. Copies are explicit (toBytes, fromBytes) and
// counted (stats), so a path that should not copy can prove it does not.
//
// A transfer moves the storage, uncopied, to a new handle and leaves every
// alias of the old one refusing reads, writes and transfers: the new handle
// is its only owner. This is how a buffer crosses to a compute task
// (transport.h): the move commits only once the task's whole input has been
// copied, and rolls back otherwise. Once committed, the storage follows the
// task's handle: a refused submission or a cancelled task releases it.
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <memory>
#include <span>
#include <string>
#include <type_traits>

#include "bytes.h"
#include "core.h"
#include "execution.h"
#include "handle.h"
#include "jserror.h"
#include "jsstring.h"
#include "transport.h"

namespace lucent {

class NativeBufferObject;
using NativeBuffer = Ref<NativeBufferObject>;

/// What every native buffer has done since the process started.
struct NativeBufferStats {
  uint64_t allocated = 0;
  uint64_t adopted = 0;
  /// Storage released (closed, or its last reference gone).
  uint64_t released = 0;
  /// Storage moved to a new handle.
  uint64_t transfers = 0;
  /// Payload copies made (toBytes, fromBytes), and their bytes.
  uint64_t copies = 0;
  uint64_t bytesCopied = 0;
};

class NativeBufferObject final : public Object {
 public:
  enum class State : uint8_t { Open, Transferring, Transferred, Closed };

  /// Releases adopted storage.
  using Destroy = std::function<void(uint8_t* data, size_t size)>;

  /// `size` zeroed bytes, which any thread may free. `origin` names the
  /// buffer in errors and reports.
  static NativeBuffer allocate(double size, String origin = {});

  /// Takes `size` bytes at `data`: `destroy` releases them, on `destroyOn`'s
  /// thread if given (posted there from any other), else wherever the buffer
  /// is released. `destroyOn` must outlive the buffer.
  static NativeBuffer adopt(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* destroyOn = nullptr,
                            String origin = {});

  /// Takes `size` bytes at `data` that no one may write, as adopt does: an
  /// immutable NSData's, or a pixel buffer locked for reading. Reads,
  /// handles, transfers and copies go on; a write borrow and
  /// transferToArrayBuffer() (JavaScript would write it) throw
  /// InvalidStateError.
  static NativeBuffer adoptReadOnly(const uint8_t* data, size_t size, Destroy destroy,
                                    ExecutionContext* destroyOn = nullptr, String origin = {});

  /// A new buffer holding a copy of `bytes`.
  static NativeBuffer fromBytes(const Bytes& bytes, String origin = {});

  /// Releases the storage if it still holds it; an error from the release
  /// is reported.
  ~NativeBufferObject() override;

  NativeBufferObject(const NativeBufferObject&) = delete;
  NativeBufferObject& operator=(const NativeBufferObject&) = delete;

  State state() const { return stateOf(word_.load(std::memory_order_acquire)); }

  bool isOpen() const { return state() == State::Open; }

  /// The bytes it holds: 0 once closed or transferred.
  size_t size() const { return size_.load(std::memory_order_acquire); }

  /// What it holds, for JavaScript's collector: 0 once moved or closed.
  size_t lucentNativeSize_() override { return state() == State::Open ? size() : 0; }

  /// How many times its storage was transferred before reaching it.
  uint32_t generation() const { return generation_; }

  const String& origin() const { return origin_; }

  /// Whether its bytes are read-only (adoptReadOnly): a transfer keeps it so.
  bool readOnly() const { return readOnly_; }

  /// Borrows now in progress.
  size_t readers() const { return word_.load(std::memory_order_acquire) >> kReaderShift; }
  bool writing() const { return (word_.load(std::memory_order_acquire) & kWriter) != 0; }

  /// Calls `f(std::span<const uint8_t>)` while no one writes, and returns
  /// what it returns. Throws InvalidStateError if the buffer is not open or
  /// is being written.
  template <class F>
  decltype(auto) withRead(F&& f) {
    Borrow borrow(*this, false);
    return f(std::span<const uint8_t>(data_, size_.load(std::memory_order_relaxed)));
  }

  /// Calls `f(std::span<uint8_t>)` with the buffer to itself. Throws
  /// InvalidStateError if it is not open or is borrowed.
  template <class F>
  decltype(auto) withWrite(F&& f) {
    Borrow borrow(*this, true);
    return f(std::span<uint8_t>(data_, size_.load(std::memory_order_relaxed)));
  }

  /// A copy of the bytes (a Uint8Array snapshot), under a read borrow.
  Bytes toBytes();

  /// Releases the storage and returns true if it was open; false, at once,
  /// if it was already closed or transferred. Throws InvalidStateError
  /// while borrowed. Run here, the release's error reaches the caller;
  /// posted to its executor, it is reported.
  bool close();

  /// Moves the storage to a new handle, one generation on, and returns it:
  /// this one, and every alias of it, refuses access from now on. Throws
  /// InvalidStateError if it is not open or is borrowed.
  NativeBuffer transfer();

  /// A handle of the bytes' address for other native code, which borrows
  /// them for read until it is released: reads go on, while writes,
  /// transfers and closing refuse (InvalidStateError). Throws, as a read
  /// borrow does, unless the buffer is open and unwritten. An empty buffer's
  /// handle has no address to give: a RangeError.
  NativeHandle handle();

  /// Moves the storage into an ArrayBuffer, uncopied: this handle and its
  /// aliases refuse access from now on, as after transfer(), and the
  /// ArrayBuffer's last holder (Lucent's or JavaScript's) runs the release
  /// the storage needs, on its executor. Counted as a transfer. A read-only
  /// buffer throws InvalidStateError: an ArrayBuffer is writable.
  ArrayBuffer transferToArrayBuffer();

  static NativeBufferStats stats();

  /// Counted copies between borrowed bytes and a Uint8Array, for callers
  /// that cannot be lent the storage itself (JavaScript): out of a read
  /// borrow's bytes, and back into a write borrow's (what fits).
  static Bytes copyOut(std::span<const uint8_t> bytes);
  static void copyIn(std::span<uint8_t> to, const Bytes& from);

 private:
  friend struct Transport<NativeBuffer>;

  // The word: state in the low two bits, then the write flag, then the
  // number of readers. 0 is open with no borrow.
  static constexpr uint32_t kStateMask = 3;
  static constexpr uint32_t kWriter = 4;
  static constexpr int kReaderShift = 3;
  static constexpr uint32_t kReader = 1u << kReaderShift;

  static State stateOf(uint32_t word) { return static_cast<State>(word & kStateMask); }

  /// A borrow for one call; keeps the buffer alive while it lasts.
  class Borrow {
   public:
    Borrow(NativeBufferObject& buffer, bool write);
    ~Borrow();

    Borrow(const Borrow&) = delete;
    Borrow& operator=(const Borrow&) = delete;

   private:
    std::shared_ptr<Object> keep_;
    NativeBufferObject& buffer_;
    const bool write_;
  };

  NativeBufferObject(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* destroyOn, String origin,
                     uint32_t generation, bool readOnly);

  /// Throws the InvalidStateError for a use the word refuses.
  [[noreturn]] void refuse(uint32_t word) const;
  /// Throws the InvalidStateError for writing read-only bytes, `why` ending its first clause.
  [[noreturn]] void refuseWrite(const char* why) const;
  /// "NativeBuffer", with its origin when it has one.
  String name() const;

  /// Moves from open with no borrow to `to`; throws if it cannot.
  void seize(State to);

  /// A transfer in two steps, so a failed copy can undo it: the storage
  /// moves to the returned handle at once, while this one refuses access;
  /// commit leaves it transferred, abort takes the storage back.
  NativeBuffer beginTransfer();
  void commitTransfer();
  void abortTransfer(const NativeBuffer& successor);

  /// Releases storage taken from a buffer, on its executor.
  static void release(uint8_t* data, size_t size, Destroy destroy, ExecutionContext* on);

  std::atomic<uint32_t> word_{0};

  // Changed only by whoever seized the word: read under a borrow.
  uint8_t* data_;
  std::atomic<size_t> size_;
  Destroy destroy_;
  ExecutionContext* destroyOn_;

  const String origin_;
  const uint32_t generation_;
  const bool readOnly_;
};

/// The bytes a borrow lends compiled code, read as elements of kind K
/// (typed::Uint8 for withRead's ByteSpan, another for withReadAs) with a
/// typed array's semantics: reads out of range are undefined, writes out of
/// range are ignored, values convert as the kind converts them. Elements
/// are read and written through memcpy, so the bytes need no alignment. The
/// compiler keeps a span inside the callback it was lent to (it cannot be
/// stored, returned or awaited across), so it never outlives its borrow.
template <class K, bool Writable>
class BasicSpan {
 public:
  using Kind = K;
  using Byte = std::conditional_t<Writable, uint8_t, const uint8_t>;
  using E = typename K::E;
  using V = typename K::V;
  static constexpr size_t kElement = sizeof(E);

  /// No bytes: what a variable holds before a span is assigned to it.
  BasicSpan() = default;
  /// Over `bytes`, whose size is a whole number of elements.
  explicit BasicSpan(std::span<Byte> bytes) : bytes_(bytes) {}

  size_t size() const { return bytes_.size() / kElement; }
  double length() const { return static_cast<double>(size()); }
  const uint8_t* data() const { return bytes_.data(); }

  Opt<V> get(double index) const {
    if (!contains(index)) return undefined;

    return at(static_cast<size_t>(index));
  }

  V at(size_t i) const {
    E e;
    std::memcpy(&e, bytes_.data() + i * kElement, kElement);
    return K::load(e);
  }

  void set(double index, const V& value) const
    requires Writable
  {
    if (contains(index)) put(static_cast<size_t>(index), K::store(value));
  }

  /// TypedArray.prototype.fill: `start` and `end` count from the end when negative.
  void fill(const V& value, double start = 0) const
    requires Writable
  {
    fill(value, start, length());
  }

  void fill(const V& value, double start, double end) const
    requires Writable
  {
    size_t from = detail::relativeIndex(start, size());
    size_t to = detail::relativeIndex(end, size());
    E e = K::store(value);

    for (size_t i = from; i < to; i++) put(i, e);
  }

  /// TypedArray.prototype.set with a typed array whose values are of the same kind (numbers or bigints).
  template <class K2>
  void setFrom(const TypedArray<K2>& source, double offset = 0) const
    requires Writable && std::is_same_v<typename K2::V, V>
  {
    size_t at = fits(source.size(), offset);

    if constexpr (std::is_same_v<K2, K>)
      std::memmove(bytes_.data() + at * kElement, source.data(), source.size() * kElement);
    else
      for (size_t i = 0; i < source.size(); i++) put(at + i, K::store(source.at(i)));
  }

  /// TypedArray.prototype.set with an array.
  void setFrom(const Array<V>& source, double offset = 0) const
    requires Writable
  {
    size_t at = fits(source.size(), offset);

    for (size_t i = 0; i < source.size(); i++) put(at + i, K::store(source.at(i)));
  }

 private:
  bool contains(double index) const { return index >= 0 && index < length() && std::trunc(index) == index; }

  void put(size_t i, E e) const
    requires Writable
  {
    std::memcpy(bytes_.data() + i * kElement, &e, kElement);
  }

  size_t fits(size_t count, double offset) const {
    if (!(offset >= 0) || static_cast<double>(count) + std::trunc(offset) > length())
      throwRangeError("offset is out of bounds");

    return static_cast<size_t>(offset);
  }

  std::span<Byte> bytes_;
};

template <bool Writable>
using BasicByteSpan = BasicSpan<typed::Uint8, Writable>;
using ByteSpan = BasicSpan<typed::Uint8, false>;
using MutableByteSpan = BasicSpan<typed::Uint8, true>;
/// What withReadAs and withWriteAs lend: the bytes as K's elements.
template <class K>
using TypedSpan = BasicSpan<K, false>;
template <class K>
using MutableTypedSpan = BasicSpan<K, true>;

/// The same bytes: two borrows of one buffer lend equal spans.
template <class K, bool Writable>
bool strictEquals(const BasicSpan<K, Writable>& a, const BasicSpan<K, Writable>& b) {
  return a.data() == b.data() && a.size() == b.size();
}

/// Like a typed array's: the elements joined with commas.
template <class K, bool Writable>
String toJsString(const BasicSpan<K, Writable>& b) {
  String out;
  for (size_t i = 0; i < b.size(); i++) {
    if (i > 0) out += String::fromLatin1(",");
    out += typed::valueString(b.at(i));
  }
  return out;
}

/// `buffer.withRead(f)` as compiled: f is lent a ByteSpan.
template <class F>
decltype(auto) withRead(const NativeBuffer& buffer, F&& f) {
  return buffer->withRead([&](std::span<const uint8_t> bytes) -> decltype(auto) { return f(ByteSpan(bytes)); });
}

/// `buffer.withWrite(f)` as compiled: f is lent a MutableByteSpan.
template <class F>
decltype(auto) withWrite(const NativeBuffer& buffer, F&& f) {
  return buffer->withWrite([&](std::span<uint8_t> bytes) -> decltype(auto) { return f(MutableByteSpan(bytes)); });
}

namespace detail {
/// A RangeError unless `size` bytes are a whole number of K's elements, as
/// `new Float32Array(buffer)` checks.
template <class K>
void wholeElements(size_t size) {
  constexpr size_t n = sizeof(typename K::E);
  if (size % n != 0)
    throwRangeError((std::string("byte length of ") + K::name + " should be a multiple of " + std::to_string(n)).c_str());
}
}  // namespace detail

/// `buffer.withReadAs(Float32Array, f)` as compiled: f is lent a TypedSpan.
template <class K, class F>
decltype(auto) withReadAs(const NativeBuffer& buffer, F&& f) {
  return buffer->withRead([&](std::span<const uint8_t> bytes) -> decltype(auto) {
    detail::wholeElements<K>(bytes.size());
    return f(TypedSpan<K>(bytes));
  });
}

/// `buffer.withWriteAs(Float32Array, f)` as compiled: f is lent a MutableTypedSpan.
template <class K, class F>
decltype(auto) withWriteAs(const NativeBuffer& buffer, F&& f) {
  return buffer->withWrite([&](std::span<uint8_t> bytes) -> decltype(auto) {
    detail::wholeElements<K>(bytes.size());
    return f(MutableTypedSpan<K>(bytes));
  });
}

/// `span[i]` read for a compound assignment: a RangeError out of range, as for a typed array.
template <class K, bool Writable>
typename K::V elementAt(const BasicSpan<K, Writable>& span, double i) {
  Opt<typename K::V> v = span.get(i);
  if (!v.has()) throwRangeError((std::string(K::name) + " index out of bounds").c_str());

  return v.get();
}

template <class K>
typename K::V setElement(const MutableTypedSpan<K>& span, double i, const typename K::V& v) {
  span.set(i, v);
  return v;
}

/// A buffer crosses to a task by moving: once per input however often it
/// appears, committed with the rest of the input.
template <>
struct Transport<NativeBuffer> {
  static NativeBuffer copy(const NativeBuffer& source, CopyGraph& graph) {
    if (!source) return source;

    if (auto* moved = graph.find<NativeBuffer>(source.get())) return *moved;

    NativeBuffer moved = source->beginTransfer();
    graph.remember(source.get(), moved);

    graph.onCommit([source] { source->commitTransfer(); }, [source, moved] { source->abortTransfer(moved); });
    return moved;
  }
};

}  // namespace lucent
