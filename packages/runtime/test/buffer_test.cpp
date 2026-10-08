// Unit tests for native buffers (lucent/buffer.h): storage owned natively,
// borrowed for reading or writing, closed, released on its executor, and
// moved to compute tasks without copying its bytes. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <future>
#include <memory>
#include <span>
#include <string>
#include <thread>
#include <vector>

#include "lucent/buffer.h"
#include "lucent/compute.h"
#include "lucent/lucent.h"
#include "lucent/transport.h"

using namespace lucent;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                                 \
  do {                                                                              \
    checks++;                                                                       \
    if (!(cond)) {                                                                  \
      failures++;                                                                   \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                               \
  } while (0)

using Clock = std::chrono::steady_clock;

static String str(const char* s) { return String::fromUtf8(s); }

/// The name and message of the Lucent error `f` throws, "" if none.
template <class F>
static std::string thrown(F f) {
  try {
    f();
  } catch (const Exception& e) {
    return e.error()->name.toUtf8() + ": " + e.error()->message.toUtf8();
  }

  return "";
}

template <class F>
static std::string thrownName(F f) {
  std::string what = thrown(f);
  return what.substr(0, what.find(':'));
}

/// Polls `done` for up to `ms` milliseconds.
template <class F>
static bool within(int ms, F done) {
  auto deadline = Clock::now() + std::chrono::milliseconds(ms);

  while (!done()) {
    if (Clock::now() > deadline) return false;

    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  return true;
}

/// Runs `f` as a turn of `context` and returns its result.
template <class F>
static auto inside(ExecutionContext& context, F f) -> decltype(f()) {
  using R = decltype(f());
  std::promise<R> result;
  auto future = result.get_future();

  context.post([&] {
    if constexpr (std::is_void_v<R>) {
      f();
      result.set_value();
    } else {
      result.set_value(f());
    }
  });

  if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    std::fprintf(stderr, "a turn did not run within 5 s\n");
    std::abort();
  }

  return future.get();
}

/// What a promise made on its owner settled with.
template <class T>
struct Watched {
  std::atomic<int> settled{0};
  std::atomic<bool> fulfilled{false};
  /// Written before `settled`.
  std::string error;
  detail::Stored<T> value{};
};

template <class T, class Submit>
static std::shared_ptr<Watched<T>> watch(ExecutionContext& owner, Submit submit) {
  auto watched = std::make_shared<Watched<T>>();

  inside(owner, [&] {
    Promise<T> promise = submit();

    promise.onSettled([watched, promise] {
      if (promise.fulfilled()) {
        watched->value = promise.value();
        watched->fulfilled = true;
      } else {
        watched->error = promise.error()->name.toUtf8();
      }

      watched->settled++;
    });
  });

  return watched;
}

template <class T>
static bool settles(const std::shared_ptr<Watched<T>>& watched) {
  return within(5000, [&] { return watched->settled.load() > 0; });
}

/// Storage adopted from "native code", recording its release.
struct Native {
  std::atomic<int> destroyed{0};
  std::atomic<ExecutionContext*> destroyedOn{nullptr};
  std::atomic<std::thread::id> destroyedBy{};

  NativeBuffer adopt(size_t size, ExecutionContext* on = nullptr, const char* origin = "test") {
    auto* data = new uint8_t[size];
    for (size_t i = 0; i < size; i++) data[i] = static_cast<uint8_t>(i);

    return NativeBufferObject::adopt(
        data, size,
        [this](uint8_t* bytes, size_t) {
          delete[] bytes;
          destroyedOn = ExecutionContext::current();
          destroyedBy = std::this_thread::get_id();
          destroyed++;
        },
        on, str(origin));
  }
};

static double sum(std::span<const uint8_t> bytes) {
  double total = 0;
  for (uint8_t b : bytes) total += b;
  return total;
}

static const uint8_t* where(std::span<const uint8_t> bytes) { return bytes.data(); }

struct Shape : Object {
  double sides = 0;
};

struct Square : Shape {};

namespace lucent {

template <>
struct Transport<Ref<Shape>> {
  static Ref<Shape> copy(const Ref<Shape>& source, CopyGraph& graph) {
    return transportObject(source, graph, [](const Shape& from, Shape& to, CopyGraph&) { to.sides = from.sides; });
  }
};

}  // namespace lucent

// --- tasks, as the compiler would emit their entries ---------------------------

/// Sums the bytes, noting where they were.
static double scanRun(std::tuple<NativeBuffer, const uint8_t**>&& in, TaskContext&) {
  auto& [buffer, seen] = in;

  return buffer->withRead([&](std::span<const uint8_t> bytes) {
    *seen = bytes.data();
    return sum(bytes);
  });
}
static constexpr TaskEntry<std::tuple<NativeBuffer, const uint8_t**>, double> scan{"scan", scanRun};

static NativeBuffer makeRun(std::tuple<double>&& in, TaskContext&) {
  NativeBuffer made = NativeBufferObject::allocate(std::get<0>(in), String::fromLatin1("made"));
  made->withWrite([](std::span<uint8_t> bytes) { bytes[0] = 5; });
  return made;
}
static constexpr TaskEntry<std::tuple<double>, NativeBuffer> make{"make", makeRun};

/// Holds a worker until `release` is set.
static double holdRun(std::tuple<std::atomic<bool>*>&& in, TaskContext&) {
  within(5000, [&] { return std::get<0>(in)->load(); });
  return 0;
}
static constexpr TaskEntry<std::tuple<std::atomic<bool>*>, double> hold{"hold", holdRun};

namespace lucent {

// Test-only: raw pointers the test shares with its tasks on purpose.
template <>
struct Transport<const uint8_t**> {
  static const uint8_t** copy(const uint8_t** const& p, CopyGraph&) { return p; }
};

template <>
struct Transport<std::atomic<bool>*> {
  static std::atomic<bool>* copy(std::atomic<bool>* const& p, CopyGraph&) { return p; }
};

}  // namespace lucent

// --- owning and borrowing -------------------------------------------------------

static void allocatedBuffersAreZeroedAndOpen() {
  NativeBufferStats before = NativeBufferObject::stats();

  NativeBuffer buffer = NativeBufferObject::allocate(16, str("frame"));

  CHECK(buffer->isOpen() && buffer->state() == NativeBufferObject::State::Open);
  CHECK(buffer->size() == 16 && buffer->generation() == 0);
  CHECK(buffer->origin() == str("frame"));
  CHECK(buffer->withRead(sum) == 0);

  buffer->withWrite([](std::span<uint8_t> bytes) {
    for (auto& b : bytes) b = 7;
  });
  CHECK(buffer->withRead(sum) == 16 * 7);

  NativeBufferStats after = NativeBufferObject::stats();
  CHECK(after.allocated - before.allocated == 1);
  CHECK(after.copies == before.copies);

  CHECK(thrownName([] { NativeBufferObject::allocate(-1); }) == "RangeError");
  CHECK(thrownName([] { NativeBufferObject::allocate(1.5); }) == "RangeError");
}

static void readsShareAndWritesExclude() {
  NativeBuffer buffer = NativeBufferObject::allocate(4);

  // Reads nest; a write needs the buffer to itself.
  buffer->withRead([&](std::span<const uint8_t>) {
    CHECK(buffer->readers() == 1);
    CHECK(buffer->withRead([&](std::span<const uint8_t>) { return buffer->readers(); }) == 2);
    CHECK(thrown([&] { buffer->withWrite([](std::span<uint8_t>) {}); }) == "InvalidStateError: NativeBuffer is borrowed");
  });

  buffer->withWrite([&](std::span<uint8_t>) {
    CHECK(buffer->writing());
    CHECK(thrownName([&] { buffer->withRead([](std::span<const uint8_t>) {}); }) == "InvalidStateError");
    CHECK(thrownName([&] { buffer->withWrite([](std::span<uint8_t>) {}); }) == "InvalidStateError");
  });

  // A borrow ends even when its function throws.
  CHECK(thrownName([&] { buffer->withWrite([](std::span<uint8_t>) { throwError(str("Error"), str("inside")); }); }) == "Error");
  CHECK(!buffer->writing() && buffer->readers() == 0);

  buffer->withWrite([](std::span<uint8_t> bytes) { bytes[0] = 1; });
  CHECK(buffer->withRead(sum) == 1);
}

static void borrowsExcludeAcrossThreads() {
  NativeBuffer buffer = NativeBufferObject::allocate(64);
  std::atomic<bool> reading{false};
  std::atomic<bool> release{false};

  std::thread reader([&] {
    buffer->withRead([&](std::span<const uint8_t>) {
      reading = true;
      within(5000, [&] { return release.load(); });
    });
  });

  CHECK(within(2000, [&] { return reading.load(); }));

  // Refused at once, never waiting for the other thread.
  CHECK(thrownName([&] { buffer->withWrite([](std::span<uint8_t>) {}); }) == "InvalidStateError");
  CHECK(buffer->withRead(sum) == 0);

  release = true;
  reader.join();

  // Readers and writers race: every write that got in saw no reader.
  std::atomic<int> writes{0};
  std::atomic<int> refused{0};
  std::atomic<bool> stop{false};
  std::vector<std::thread> threads;

  for (int i = 0; i < 3; i++) {
    threads.emplace_back([&] {
      while (!stop) {
        try {
          buffer->withRead([](std::span<const uint8_t> bytes) {
            uint8_t first = bytes[0];
            for (uint8_t b : bytes) {
              if (b != first) std::abort();
            }
          });
        } catch (const Exception&) {
        }
      }
    });
  }

  threads.emplace_back([&] {
    for (int round = 0; round < 2000; round++) {
      try {
        buffer->withWrite([round](std::span<uint8_t> bytes) {
          for (auto& b : bytes) b = static_cast<uint8_t>(round);
        });
        writes++;
      } catch (const Exception&) {
        refused++;
      }
    }

    stop = true;
  });

  for (auto& t : threads) t.join();

  CHECK(writes + refused == 2000);
  CHECK(buffer->readers() == 0 && !buffer->writing());
}

static void closingReleasesOnceButAliasesStayAlive() {
  Native native;
  NativeBuffer buffer = native.adopt(8);
  NativeBuffer alias = buffer;

  CHECK(buffer->close());
  CHECK(native.destroyed == 1);

  // The alias keeps the handle alive, not the storage, and grants nothing.
  CHECK(alias->state() == NativeBufferObject::State::Closed && alias->size() == 0);
  CHECK(thrown([&] { alias->withRead(sum); }) == "InvalidStateError: NativeBuffer (test) is closed");
  CHECK(thrownName([&] { alias->withWrite([](std::span<uint8_t>) {}); }) == "InvalidStateError");
  CHECK(!alias->close());

  buffer = nullptr;
  alias = nullptr;
  CHECK(native.destroyed == 1);
}

static void aBorrowedBufferDoesNotClose() {
  Native native;
  NativeBuffer buffer = native.adopt(8);

  buffer->withRead([&](std::span<const uint8_t>) {
    CHECK(thrown([&] { buffer->close(); }) == "InvalidStateError: NativeBuffer (test) is borrowed");
  });

  CHECK(native.destroyed == 0 && buffer->isOpen());

  // Dropping the handle inside its own borrow keeps the storage until the
  // borrow ends.
  buffer->withRead([&](std::span<const uint8_t> bytes) {
    buffer = nullptr;
    CHECK(sum(bytes) == 28);
    CHECK(native.destroyed == 0);
  });

  CHECK(native.destroyed == 1);
}

static void theLastReferenceReleasesOnItsExecutor() {
  auto owner = IsolatedContext::create();
  Native native;
  NativeBuffer buffer = native.adopt(8, owner.get());

  std::thread([moved = std::move(buffer)]() mutable { moved = nullptr; }).join();

  CHECK(within(2000, [&] { return native.destroyed.load() == 1; }));
  CHECK(native.destroyedOn == owner.get());

  // Without one, wherever the last reference goes.
  Native anywhere;
  NativeBuffer other = anywhere.adopt(8);
  std::thread::id dropper;

  std::thread([&dropper, moved = std::move(other)]() mutable {
    dropper = std::this_thread::get_id();
    moved = nullptr;
  }).join();

  CHECK(anywhere.destroyed == 1 && anywhere.destroyedBy.load() == dropper);

  owner->shutdown();
}

static void snapshotsCopyAndCount() {
  NativeBuffer buffer = NativeBufferObject::allocate(1024);
  buffer->withWrite([](std::span<uint8_t> bytes) { bytes[3] = 9; });

  NativeBufferStats before = NativeBufferObject::stats();

  Bytes snapshot = buffer->toBytes();
  buffer->withWrite([](std::span<uint8_t> bytes) { bytes[3] = 1; });

  NativeBuffer copied = NativeBufferObject::fromBytes(snapshot, str("copy"));

  NativeBufferStats after = NativeBufferObject::stats();

  CHECK(snapshot.size() == 1024 && snapshot.at(3) == 9);
  CHECK(copied->size() == 1024 && copied->withRead(sum) == 9);
  CHECK(after.copies - before.copies == 2);
  CHECK(after.bytesCopied - before.bytesCopied == 2048);
}

// --- spans: what compiled code borrows ------------------------------------------

static void spansReadWhatTheBufferHolds() {
  NativeBuffer buffer = NativeBufferObject::fromBytes(Bytes(std::vector<uint8_t>{1, 2, 3}));

  double total = withRead(buffer, [&](ByteSpan bytes) {
    CHECK(buffer->readers() == 1);
    CHECK(bytes.length() == 3);
    CHECK(bytes.get(0).get() == 1 && bytes.get(2).get() == 3);
    CHECK(elementAt(bytes, 1) == 2);

    // Out of range, fractional or negative: undefined, as on a Uint8Array.
    CHECK(!bytes.get(3).has() && !bytes.get(-1).has() && !bytes.get(0.5).has());
    CHECK(thrownName([&] { elementAt(bytes, 3); }) == "RangeError");

    return bytes.at(0) + bytes.at(1) + bytes.at(2);
  });

  CHECK(total == 6);
  CHECK(buffer->readers() == 0);
}

static void spansWriteLikeAUint8Array() {
  NativeBuffer buffer = NativeBufferObject::allocate(6);

  withWrite(buffer, [&](MutableByteSpan bytes) {
    CHECK(buffer->writing());

    bytes.set(0, 258);
    bytes.set(1, -1);
    bytes.set(9, 5);
    bytes.set(0.5, 5);
    CHECK(setElement(bytes, 2, 7.9) == 7.9);

    bytes.fill(4, 3);
    bytes.fill(8, -2, -1);
  });

  CHECK(buffer->toBytes().join() == str("2,255,7,4,8,4"));

  withWrite(buffer, [](MutableByteSpan bytes) {
    bytes.fill(1);
    bytes.setFrom(Bytes(std::vector<uint8_t>{5, 6}), 4);

    CHECK(thrownName([&] { bytes.setFrom(Bytes(std::vector<uint8_t>{5, 6}), 5); }) == "RangeError");
  });

  CHECK(buffer->toBytes().join() == str("1,1,1,1,5,6"));
}

static void spansHonourTheBorrows() {
  NativeBuffer buffer = NativeBufferObject::allocate(2);

  withRead(buffer, [&](ByteSpan) {
    CHECK(thrown([&] { withWrite(buffer, [](MutableByteSpan) {}); }) == "InvalidStateError: NativeBuffer is borrowed");
  });

  buffer->close();

  CHECK(thrown([&] { withRead(buffer, [](ByteSpan) {}); }) == "InvalidStateError: NativeBuffer is closed");
}

static void boundaryCopiesAreCounted() {
  NativeBuffer buffer = NativeBufferObject::allocate(8);
  NativeBufferStats before = NativeBufferObject::stats();

  // What JavaScript is lent: a copy out, and for a write, a copy back in.
  Bytes out = buffer->withRead([](std::span<const uint8_t> bytes) { return NativeBufferObject::copyOut(bytes); });
  out.set(1, 9);

  buffer->withWrite([&](std::span<uint8_t> bytes) { NativeBufferObject::copyIn(bytes, out); });

  NativeBufferStats after = NativeBufferObject::stats();

  CHECK(buffer->toBytes().join() == str("0,9,0,0,0,0,0,0"));
  CHECK(after.copies - before.copies == 2);
  CHECK(after.bytesCopied - before.bytesCopied == 16);
}

// --- transfer -------------------------------------------------------------------

static void aTransferInvalidatesEveryAlias() {
  Native native;
  NativeBuffer buffer = native.adopt(8, nullptr, "frame");
  NativeBuffer alias = buffer;
  const uint8_t* bytes = buffer->withRead(where);
  NativeBufferStats before = NativeBufferObject::stats();

  NativeBuffer moved = buffer->transfer();

  // The same storage, not a copy, under a new handle.
  CHECK(moved != buffer && moved->isOpen());
  CHECK(moved->withRead(where) == bytes && moved->withRead(sum) == 28);
  CHECK(moved->size() == 8 && moved->generation() == 1 && moved->origin() == str("frame"));

  for (const NativeBuffer& sender : {buffer, alias}) {
    CHECK(sender->state() == NativeBufferObject::State::Transferred && sender->size() == 0);
    CHECK(thrown([&] { sender->withRead(sum); }) == "InvalidStateError: NativeBuffer (frame) was transferred");
    CHECK(thrownName([&] { sender->withWrite([](std::span<uint8_t>) {}); }) == "InvalidStateError");
    CHECK(thrownName([&] { sender->transfer(); }) == "InvalidStateError");

    // Disposing a moved-from buffer is harmless.
    CHECK(!sender->close());
  }

  NativeBufferStats after = NativeBufferObject::stats();
  CHECK(after.transfers - before.transfers == 1);
  CHECK(after.copies == before.copies && after.released == before.released);

  buffer = nullptr;
  alias = nullptr;
  CHECK(native.destroyed == 0);

  moved = nullptr;
  CHECK(native.destroyed == 1);
}

static void aBorrowedBufferDoesNotTransfer() {
  Native native;
  NativeBuffer buffer = native.adopt(8);

  buffer->withRead([&](std::span<const uint8_t>) {
    CHECK(thrown([&] { buffer->transfer(); }) == "InvalidStateError: NativeBuffer (test) is borrowed");
  });

  CHECK(buffer->isOpen() && buffer->withRead(sum) == 28);

  buffer->close();
  CHECK(thrownName([&] { buffer->transfer(); }) == "InvalidStateError");
}

static void oneInputMovesABufferOnce() {
  NativeBuffer buffer = NativeBufferObject::allocate(4);
  NativeBufferStats before = NativeBufferObject::stats();

  auto [a, b] = transportCopy(std::make_tuple(buffer, buffer));

  CHECK(a == b && a != buffer && a->isOpen());
  CHECK(buffer->state() == NativeBufferObject::State::Transferred);
  CHECK(NativeBufferObject::stats().transfers - before.transfers == 1);
}

static void aFailedCopyLeavesTheSenderOpen() {
  Native native;
  NativeBuffer buffer = native.adopt(8);
  const uint8_t* bytes = buffer->withRead(where);
  Ref<Shape> square = std::make_shared<Square>();
  NativeBufferStats before = NativeBufferObject::stats();

  CHECK(thrownName([&] { transportCopy(std::make_tuple(buffer, square)); }) == "DataCloneError");

  CHECK(buffer->isOpen() && buffer->size() == 8 && buffer->generation() == 0);
  CHECK(buffer->withRead(where) == bytes && buffer->withRead(sum) == 28);
  CHECK(NativeBufferObject::stats().transfers == before.transfers);
  CHECK(native.destroyed == 0);

  // And it still moves afterwards.
  NativeBuffer moved = transportCopy(buffer);
  CHECK(moved->withRead(where) == bytes);
}

static void tasksTakeTheStorageWithoutACopy() {
  auto owner = IsolatedContext::create();
  Native native;
  NativeBuffer buffer = native.adopt(1024, nullptr);
  const uint8_t* bytes = buffer->withRead(where);
  const uint8_t* seen = nullptr;
  NativeBufferStats before = NativeBufferObject::stats();

  auto scanned = watch<double>(*owner, [&] { return compute(scan, std::make_tuple(buffer, &seen)); });

  CHECK(settles(scanned) && scanned->fulfilled);
  CHECK(scanned->value == 4 * (255 * 256 / 2));
  CHECK(seen == bytes);
  CHECK(buffer->state() == NativeBufferObject::State::Transferred);

  // The task's handle was the last: the storage went with it, on the worker.
  CHECK(within(2000, [&] { return native.destroyed.load() == 1; }));
  ExecutionContext* on = native.destroyedOn;
  CHECK(on && on != owner.get() && on != &Actor::shared() && on != &ExecutionContext::main());

  NativeBufferStats after = NativeBufferObject::stats();
  CHECK(after.copies == before.copies && after.transfers - before.transfers == 1);

  // Storage that must be released on its owner is posted there instead.
  Native affine;
  NativeBuffer pinned = affine.adopt(64, owner.get());

  auto pinnedScan = watch<double>(*owner, [&] { return compute(scan, std::make_tuple(pinned, &seen)); });

  CHECK(settles(pinnedScan) && pinnedScan->fulfilled);
  CHECK(within(2000, [&] { return affine.destroyed.load() == 1; }));
  CHECK(affine.destroyedOn == owner.get());

  owner->shutdown();
}

static void resultsComeBackWithoutACopy() {
  auto owner = IsolatedContext::create();
  NativeBufferStats before = NativeBufferObject::stats();

  auto made = watch<NativeBuffer>(*owner, [] { return compute(make, std::make_tuple(4096.0)); });

  CHECK(settles(made) && made->fulfilled);
  CHECK(made->value->isOpen() && made->value->size() == 4096 && made->value->generation() == 0);
  CHECK(made->value->withRead([](std::span<const uint8_t> bytes) { return bytes[0]; }) == 5);

  NativeBufferStats after = NativeBufferObject::stats();
  CHECK(after.copies == before.copies && after.transfers == before.transfers);

  made->value = nullptr;
  owner->shutdown();
}

static void aRefusedSubmissionReleasesTheBuffer() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 1});
  std::atomic<bool> release{false};
  const uint8_t* seen = nullptr;

  auto held = watch<double>(*owner, [&] { return compute(hold, std::make_tuple(&release), {.pool = pool}); });
  auto queued = watch<double>(*owner, [&] { return compute(hold, std::make_tuple(&release), {.pool = pool}); });

  Native native;
  NativeBuffer buffer = native.adopt(16);

  auto refused = watch<double>(*owner, [&] { return compute(scan, std::make_tuple(buffer, &seen), {.pool = pool}); });

  // The move was spent: the storage is released, not stranded.
  CHECK(settles(refused) && refused->error == "QuotaExceededError");
  CHECK(buffer->state() == NativeBufferObject::State::Transferred);
  CHECK(within(2000, [&] { return native.destroyed.load() == 1; }));

  release = true;
  CHECK(settles(held) && settles(queued));

  pool->shutdown();
  owner->shutdown();
}

static void cancellingAQueuedTaskReleasesTheBuffer() {
  auto owner = IsolatedContext::create();
  auto pool = ComputePool::create({.workers = 1, .capacity = 2});
  std::atomic<bool> release{false};
  const uint8_t* seen = nullptr;

  auto held = watch<double>(*owner, [&] { return compute(hold, std::make_tuple(&release), {.pool = pool}); });

  Native native;
  NativeBuffer buffer = native.adopt(16, owner.get());
  AbortController controller = inside(*owner, [] { return std::make_shared<AbortControllerObject>(); });

  auto cancelled = watch<double>(*owner, [&] {
    return compute(scan, std::make_tuple(buffer, &seen), {.signal = controller->signal, .pool = pool});
  });

  inside(*owner, [&] { controller->abort(undefined); });

  CHECK(settles(cancelled) && cancelled->error == "AbortError");
  CHECK(within(2000, [&] { return native.destroyed.load() == 1; }));
  CHECK(native.destroyedOn == owner.get() && seen == nullptr);

  release = true;
  CHECK(settles(held));

  pool->shutdown();
  owner->shutdown();
}

static void aBorrowedBufferIsNotSubmitted() {
  auto owner = IsolatedContext::create();
  Native native;
  NativeBuffer buffer = native.adopt(8);
  const uint8_t* seen = nullptr;

  // Refused while the caller reads it: the promise is rejected at once.
  std::string refused = inside(*owner, [&] {
    return buffer->withRead([&](std::span<const uint8_t>) -> std::string {
      Promise<double> p = compute(scan, std::make_tuple(buffer, &seen));
      return p.settled() && !p.fulfilled() ? p.error()->name.toUtf8() : "";
    });
  });

  CHECK(refused == "InvalidStateError");
  CHECK(buffer->isOpen() && native.destroyed == 0);

  owner->shutdown();
}

static void copiesAreCountedExactly() {
  auto owner = IsolatedContext::create();

  for (double size : {1024.0, 1048576.0}) {
    NativeBuffer buffer = NativeBufferObject::allocate(size);
    const uint8_t* seen = nullptr;
    NativeBufferStats start = NativeBufferObject::stats();

    // Handed to a task and scanned there: no copy.
    auto scanned = watch<double>(*owner, [&] { return compute(scan, std::make_tuple(buffer, &seen)); });
    CHECK(settles(scanned) && scanned->fulfilled);

    NativeBufferStats handed = NativeBufferObject::stats();
    CHECK(handed.copies == start.copies && handed.bytesCopied == start.bytesCopied);

    // A snapshot each way: one copy of the payload each.
    NativeBuffer again = NativeBufferObject::allocate(size);
    Bytes snapshot = again->toBytes();
    NativeBuffer back = NativeBufferObject::fromBytes(snapshot);

    NativeBufferStats snapped = NativeBufferObject::stats();
    CHECK(snapped.copies - handed.copies == 2);
    CHECK(snapped.bytesCopied - handed.bytesCopied == static_cast<uint64_t>(2 * size));

    std::printf("buffer: %.0f bytes: handoff to a task %llu copies / %llu bytes; snapshot out and in %llu copies / %llu bytes\n",
                size, static_cast<unsigned long long>(handed.copies - start.copies),
                static_cast<unsigned long long>(handed.bytesCopied - start.bytesCopied),
                static_cast<unsigned long long>(snapped.copies - handed.copies),
                static_cast<unsigned long long>(snapped.bytesCopied - handed.bytesCopied));
  }

  owner->shutdown();
}

int main() {
  allocatedBuffersAreZeroedAndOpen();
  readsShareAndWritesExclude();
  borrowsExcludeAcrossThreads();
  closingReleasesOnceButAliasesStayAlive();
  aBorrowedBufferDoesNotClose();
  theLastReferenceReleasesOnItsExecutor();
  snapshotsCopyAndCount();

  spansReadWhatTheBufferHolds();
  spansWriteLikeAUint8Array();
  spansHonourTheBorrows();
  boundaryCopiesAreCounted();

  aTransferInvalidatesEveryAlias();
  aBorrowedBufferDoesNotTransfer();
  oneInputMovesABufferOnce();
  aFailedCopyLeavesTheSenderOpen();
  tasksTakeTheStorageWithoutACopy();
  resultsComeBackWithoutACopy();
  aRefusedSubmissionReleasesTheBuffer();
  cancellingAQueuedTaskReleasesTheBuffer();
  aBorrowedBufferIsNotSubmitted();
  copiesAreCountedExactly();

  std::printf("buffer: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
