// Unit tests for native extensions (lucent/extension.h): handles that
// destroy their C pointer once, on the context they require, and the
// checked conversions between Lucent values and C parameters. Built and
// run by `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <climits>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <memory>
#include <string>
#include <thread>

#include "lucent/extension.h"
#include "lucent/lucent.h"

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

/// The error `f` throws: name, message and code, or empty if it throws none.
template <class F>
static std::string thrown(F f) {
  try {
    f();
  } catch (const Exception& e) {
    const Error& err = e.error();
    std::string out = err->name.toUtf8() + ": " + err->message.toUtf8();

    if (err->code.has()) out += " [" + err->code.get().toUtf8() + "]";
    return out;
  }

  return "";
}

/// Polls `done` for up to two seconds.
template <class F>
static bool within(F done) {
  auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);

  while (!done()) {
    if (std::chrono::steady_clock::now() > deadline) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  return true;
}

// A C "library": counters it keeps, as its own code would.
struct Gauge {
  int value;
};

static std::atomic<int> destroyed{0};
static std::atomic<bool> destroyedOnMain{false};

static void destroyGauge(void* p) {
  destroyed++;
  destroyedOnMain = onMainThread();
  delete static_cast<Gauge*>(p);
}

// --- handles ----------------------------------------------------------------

/// Open until closed: the pointer is reachable, then every use throws, and
/// the destroy function runs exactly once however often it closes.
static void closesOnce() {
  destroyed = 0;
  Handle h = Handle::open("Gauge", new Gauge{7}, destroyGauge);

  CHECK(h.get<Gauge>()->value == 7);

  h.close();
  CHECK(destroyed == 1);

  h.close();
  CHECK(destroyed == 1);
  CHECK(thrown([&] { h.get<Gauge>(); }) == "InvalidStateError: Gauge is closed");
}

/// The last copy going destroys it; copies are the same handle.
static void lastCopyDestroys() {
  destroyed = 0;

  {
    Handle a = Handle::open("Gauge", new Gauge{1}, destroyGauge);
    Handle b = a;

    CHECK(strictEquals(a, b));

    // Another handle, whose only copy goes at the end of the expression.
    CHECK(!strictEquals(a, Handle::open("Gauge", new Gauge{1}, destroyGauge)));
    CHECK(destroyed == 1);

    b.close();
    CHECK(destroyed == 2);
    CHECK(thrown([&] { a.get<Gauge>(); }) == "InvalidStateError: Gauge is closed");
  }

  CHECK(destroyed == 2);

  { Handle c = Handle::open("Gauge", new Gauge{2}, destroyGauge); }
  CHECK(destroyed == 3);
}

/// A main-thread handle is destroyed on the main thread, wherever it closes.
static void destroyedOnItsContext() {
  destroyed = 0;
  destroyedOnMain = false;

  Handle h = Handle::open("Gauge", new Gauge{3}, destroyGauge, &ExecutionContext::main());
  std::thread([h] { h.close(); }).join();

  CHECK(within([] { return destroyed.load() == 1; }));
  CHECK(destroyedOnMain);
}

/// A close while a call uses the pointer (from another thread) destroys it
/// once the call is done, never under it; later uses throw.
static void closeWaitsForTheCall() {
  destroyed = 0;
  Handle h = Handle::open("Gauge", new Gauge{4}, destroyGauge);

  {
    auto use = h.use<Gauge>();
    std::thread([h] { h.close(); }).join();

    CHECK(destroyed == 0);
    CHECK(use.get()->value == 4);
    CHECK(thrown([&] { h.use<Gauge>(); }) == "InvalidStateError: Gauge is closed");
  }

  CHECK(destroyed == 1);
}

/// An empty handle (a field not yet set) refuses use.
static void emptyRefusesUse() {
  Handle h;

  CHECK(thrown([&] { h.get<Gauge>(); }) == "InvalidStateError: the handle is not open");
  h.close();
}

// --- conversions ------------------------------------------------------------

/// Numbers become C integers as WebIDL's [EnforceRange] does: truncated,
/// and a RangeError outside the C type.
static void numbersToIntegers() {
  CHECK(ext::integer<int32_t>(41.9, "count") == 41);
  CHECK(ext::integer<int32_t>(-41.9, "count") == -41);
  CHECK(ext::integer<uint8_t>(255, "level") == 255);

  CHECK(thrown([] { ext::integer<uint8_t>(256, "level"); }) ==
        "RangeError: level must be an integer from 0 to 255, not 256");
  CHECK(thrown([] { ext::integer<int32_t>(0.0 / 0.0, "count"); }) ==
        "RangeError: count must be an integer from -2147483648 to 2147483647, not NaN");
  CHECK(thrown([] { ext::integer<uint32_t>(-1, "size"); }) ==
        "RangeError: size must be an integer from 0 to 4294967295, not -1");
}

/// Bigints become 64-bit C integers exactly.
static void bigintsToIntegers() {
  CHECK(ext::integer<int64_t>(BigInt::fromInt64(INT64_MIN), "offset") == INT64_MIN);
  CHECK(ext::integer<uint64_t>(BigInt::fromUint64(UINT64_MAX), "total") == UINT64_MAX);

  CHECK(thrown([] { ext::integer<uint64_t>(BigInt::fromInt64(-1), "total"); }) ==
        "RangeError: total must be an integer from 0 to 18446744073709551615, not -1");
  CHECK(thrown([] { ext::integer<int64_t>(BigInt::fromUint64(UINT64_MAX), "offset"); }) ==
        "RangeError: offset must be an integer from -9223372036854775808 to 9223372036854775807, not 18446744073709551615");
}

/// A byte count must fit its C length type.
static void lengths() {
  CHECK(ext::length<int32_t>(10, "input") == 10);
  CHECK(thrown([] { ext::length<uint8_t>(300, "input"); }) == "RangeError: input is 300 bytes; at most 255 fit");
}

/// Bytes cross as their data, never a null pointer, even when there are none.
static void bytesPointers() {
  Bytes empty;
  Bytes three(3.0);

  CHECK(ext::data(empty) != nullptr);
  CHECK(ext::data(three) == three.data());
}

/// A number into a float parameter rounds as Math.fround does: beyond float's range, infinite.
static void floats() {
  CHECK(ext::real<float>(1.5) == 1.5f);
  CHECK(ext::real<float>(1e300) == std::numeric_limits<float>::infinity());
  CHECK(ext::real<float>(-1e300) == -std::numeric_limits<float>::infinity());

  // Just past float's largest, still nearer it than infinity: the largest, as Math.fround gives.
  CHECK(ext::real<float>(0x1.fffffefp127) == std::numeric_limits<float>::max());
  CHECK(ext::real<float>(-0x1.fffffefp127) == -std::numeric_limits<float>::max());
  CHECK(ext::real<float>(0x1.ffffffp127) == std::numeric_limits<float>::infinity());
  CHECK(ext::real<double>(1e300) == 1e300);
}

/// Strings cross as NUL-terminated UTF-8, and cannot hold NUL themselves.
static void strings() {
  CHECK(ext::utf8(String::fromUtf8("h\xC3\xA9llo"), "name") == "h\xC3\xA9llo");
  CHECK(thrown([] { ext::utf8(String::fromUtf8(std::string("a\0b", 3)), "name"); }) ==
        "TypeError: name holds a NUL character, which a C string cannot");
}

/// A failed call throws an Error with the message C reported, copied, and its code.
static void failures_() {
  CHECK(thrown([] { ext::fail("orbit_apply", "output is too short", 2); }) ==
        "Error: output is too short [2]");
  CHECK(thrown([] { ext::fail("orbit_apply", nullptr, 3); }) == "Error: orbit_apply failed [3]");
  CHECK(thrown([] { ext::fail("orbit_apply", ""); }) == "Error: orbit_apply failed");
}

int main() {
  closesOnce();
  lastCopyDestroys();
  destroyedOnItsContext();
  closeWaitsForTheCall();
  emptyRefusesUse();
  numbersToIntegers();
  bigintsToIntegers();
  lengths();
  bytesPointers();
  floats();
  strings();
  failures_();

  std::printf("extension: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
