// Unit tests for native extensions (lucent/extension.h): handles that
// destroy their C pointer once, on the context they require, and the
// checked conversions between Lucent values and C parameters. Built and
// run by `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <climits>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <future>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

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

/// What a C++ call throws is an Error (decision 0125): std::exception's what(), or that it threw.
static void cxxExceptions() {
  CHECK(ext::cxxCall("Counter.add", [] { return 2; }) == 2);
  CHECK(thrown([] { ext::cxxCall("Counter.add", []() -> int { throw std::invalid_argument("negative"); }); }) ==
        "Error: negative");
  CHECK(thrown([] { ext::cxxCall("Counter.fail", [] { throw 42; }); }) ==
        "Error: Counter.fail threw a C++ exception");
}

/// Strings, vectors and optionals cross as C++'s own, NUL characters and all.
static void cxxValues() {
  CHECK(ext::cxxString(String::fromUtf8(std::string("a\0b", 3))) == std::string("a\0b", 3));
  CHECK(ext::fromCxx(std::string_view("h\xC3\xA9")).toUtf8() == "h\xC3\xA9");

  Array<double> numbers{1.5, 2};
  std::vector<int> ints = ext::cxxVector<int>(numbers, [](double x) { return ext::integer<int>(x, "n"); });
  CHECK((ints == std::vector<int>{1, 2}));
  Array<double> back = ext::fromCxxVector(std::vector<int>{3, 4}, [](int x) { return ext::number(x); });
  CHECK(back.size() == 2 && back.at(0) == 3 && back.at(1) == 4);
  Array<bool> flags = ext::fromCxxVector(std::vector<bool>{true, false}, [](bool x) { return x; });
  CHECK(flags.size() == 2 && flags.at(0) && !flags.at(1));

  Opt<String> none;
  CHECK(!ext::cxxOptional<std::string>(none, [](const String& x) { return ext::cxxString(x); }));
  Opt<String> some(String::fromUtf8("n"));
  CHECK(ext::cxxOptional<std::string>(some, [](const String& x) { return ext::cxxString(x); }) == std::string("n"));
  CHECK(!ext::fromCxxOptional(std::optional<std::string>(), [](const std::string& x) { return ext::fromCxx(x); }).has());
  CHECK(ext::fromCxxOptional(std::optional<std::string>("y"), [](const std::string& x) { return ext::fromCxx(x); })
            .get()
            .toUtf8() == "y");
}

/// A handle of a C++ object deletes it once.
static void cxxObjects() {
  static int deleted = 0;
  struct Object {
    ~Object() { deleted++; }
  };

  Handle h = Handle::open("Object", new Object(), &ext::deleteObject<Object>);
  h.close();
  h.close();
  CHECK(deleted == 1);
}

// --- callbacks (decisions 0126 and 0128) ------------------------------------

/// Runs `f` as a turn of `context` and returns its result; the test thread,
/// in no context, waits.
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

/// What callbacks saw, from any thread.
struct Seen {
  std::mutex m;
  std::vector<std::string> entries;
  std::vector<std::thread::id> threads;

  void add(std::string e) {
    std::lock_guard<std::mutex> g(m);
    entries.push_back(std::move(e));
    threads.push_back(std::this_thread::get_id());
  }
  std::string text() {
    std::lock_guard<std::mutex> g(m);
    std::string out;
    for (const auto& e : entries) out += (out.empty() ? "" : " ") + e;
    return out;
  }
};

// A C library's callbacks, as its header declares them: the context last, or first.
using Visit = void (*)(double value, void* context);
using Keep = int (*)(void* context, const char* name, int64_t at);

static void visitEach(const double* values, int n, Visit visit, void* context) {
  for (int i = 0; i < n; i++) visit(values[i], context);
}

static int countKept(Keep keep, void* context) {
  int n = 0;
  n += keep(context, "a", 1) != 0;
  n += keep(context, nullptr, -2) != 0;
  n += keep(context, "c\xC3\xA9", INT64_MAX) != 0;
  return n;
}

static constexpr Visit visitFn = +[](double v, void* c) { return ext::callBack<Fn<void(double)>, void>(c, v); };
static constexpr Keep keepFn = +[](void* c, const char* name, int64_t at) {
  return ext::callBack<Fn<bool(String, BigInt)>, int>(c, name, at);
};

/// Called during the call on its thread, a callback runs at once, in order,
/// with what C passed copied: strings (a null one empty) and bigints.
static void callbacksRunAtOnce() {
  auto context = IsolatedContext::create();
  Seen seen;

  inside(*context, [&] {
    ext::Callback<Fn<void(double)>> each("visit_each's visit", ext::Lives::Call,
                                         Fn<void(double)>([&](double v) { seen.add(std::to_string(int(v))); }));
    const double values[] = {1, 2, 3};
    ext::call([&] { visitEach(values, 3, visitFn, each.context()); });
    each.done();
    seen.add("after");

    ext::Callback<Fn<bool(String, BigInt)>> keep(
        "count_kept's keep", ext::Lives::Call, Fn<bool(String, BigInt)>([&](String name, BigInt at) {
          seen.add("[" + name.toUtf8() + "]" + at.toString().toUtf8());
          return name.toUtf8() != "a";
        }));
    int n = ext::call([&] { return countKept(keepFn, keep.context()); });
    keep.done();
    CHECK(n == 2);
  });

  CHECK(seen.text() == "1 2 3 after [a]1 []-2 [c\xC3\xA9]9223372036854775807");
  for (auto t : seen.threads) CHECK(t == seen.threads.front());
  context->shutdown();
}

/// What a callback run at once throws, C gets zero for, and the call throws
/// once it returns; a result out of C's range is such an error.
static void throwsAfterTheCall() {
  auto context = IsolatedContext::create();
  std::vector<int> got;

  std::string error = inside(*context, [&] {
    ext::Callback<Fn<double(String, BigInt)>> keep(
        "count_kept's keep", ext::Lives::Call, Fn<double(String, BigInt)>([&](String name, BigInt) -> double {
          if (name.toUtf8().empty()) throwError(makeError(String::fromUtf8("no name")));
          return 1;
        }));
    Keep recording = +[](void* c, const char* name, int64_t at) {
      return ext::callBack<Fn<double(String, BigInt)>, int>(c, name, at);
    };
    return thrown([&] {
      int n = ext::call([&] { return countKept(recording, keep.context()); });
      got.push_back(n);
      keep.done();
    });
  });

  // The call ran to its end, the second call's zero counted out, then threw.
  CHECK(error == "Error: no name");
  CHECK(got.empty());

  std::string range = inside(*context, [&] {
    ext::Callback<Fn<double(String, BigInt)>> keep(
        "count_kept's keep", ext::Lives::Call, Fn<double(String, BigInt)>([](String, BigInt) { return 1e10; }));
    Keep recording = +[](void* c, const char* name, int64_t at) {
      return ext::callBack<Fn<double(String, BigInt)>, int>(c, name, at);
    };
    return thrown([&] { ext::call([&] { return countKept(recording, keep.context()); }); });
  });
  CHECK(range == "RangeError: count_kept's keep's result must be an integer from -2147483648 to 2147483647, not 10000000000");
  context->shutdown();
}

/// From another thread, a callback is posted to its context, in the order
/// C called it; one C wants a result from is refused, and the call throws.
static void postedFromAnotherThread() {
  auto context = IsolatedContext::create();
  Seen seen;

  std::string refused = inside(*context, [&] {
    ext::Callback<Fn<void(double)>> each("visit_each's visit", ext::Lives::Call,
                                         Fn<void(double)>([&](double v) { seen.add(std::to_string(int(v))); }));
    const double values[] = {4, 5, 6};
    ext::call([&] { std::thread([&] { visitEach(values, 3, visitFn, each.context()); }).join(); });
    each.done();
    seen.add("returned");

    ext::Callback<Fn<bool(String, BigInt)>> keep("count_kept's keep", ext::Lives::Call,
                                                 Fn<bool(String, BigInt)>([](String, BigInt) { return true; }));
    int n = -1;
    std::string error = thrown([&] {
      n = ext::call([&] {
        int r = 0;
        std::thread([&] { r = countKept(keepFn, keep.context()); }).join();
        return r;
      });
      keep.done();
    });
    CHECK(n == 0);
    return error;
  });

  CHECK(within([&] { return seen.text() == "returned 4 5 6"; }));
  CHECK(refused == "Error: count_kept's keep was called from another thread for its result, which only a call on its context's thread can give");
  context->shutdown();
}

/// A callback living for the call does nothing once it returned; one living
/// once, after its first call; one living as long as a handle, once its
/// destroy function returned.
static void lifetimes() {
  auto context = IsolatedContext::create();
  std::atomic<int> calls{0};
  const double one[] = {1};

  inside(*context, [&] {
    void* kept;
    {
      ext::Callback<Fn<void(double)>> each("visit_each's visit", ext::Lives::Call,
                                           Fn<void(double)>([&](double) { calls++; }));
      kept = each.context();
      ext::call([&] { visitEach(one, 1, visitFn, kept); });
      each.done();
    }
    visitEach(one, 1, visitFn, kept);
    CHECK(calls == 1);

    ext::Callback<Fn<void(double)>> once("visit_each's visit", ext::Lives::Once,
                                         Fn<void(double)>([&](double) { calls++; }));
    void* first = once.context();
    ext::call([&] { visitEach(one, 1, visitFn, first); });
    once.done();
    ext::call([&] { visitEach(one, 1, visitFn, first); });
    CHECK(calls == 2);

    destroyed = 0;
    Handle h = Handle::open("Gauge", new Gauge{5}, destroyGauge);
    ext::Callback<Fn<void(double)>> tick("gauge_on_tick's tick", ext::Lives::Handle,
                                         Fn<void(double)>([&](double) { calls++; }));
    void* ticking = tick.context();
    tick.until(h);
    tick.done();
    // A later call on the context's thread: at once.
    ext::call([&] { visitEach(one, 1, visitFn, ticking); });
    CHECK(calls == 3);
    h.close();
    CHECK(destroyed == 1);
    ext::call([&] { visitEach(one, 1, visitFn, ticking); });
    CHECK(calls == 3);
  });

  context->shutdown();
}

/// A C++ std::function keeps its callback while a copy lives: called during
/// a later call on its context's thread, it runs at once and gives its
/// result; its Lucent function is released on its context.
static void cxxFunctions() {
  auto context = IsolatedContext::create();
  struct Probe {
    std::atomic<std::thread::id>* where;
    ~Probe() { *where = std::this_thread::get_id(); }
  };
  std::atomic<std::thread::id> releasedOn;
  std::thread::id contextThread;
  std::function<bool(int64_t)> keepIt;

  inside(*context, [&] {
    contextThread = std::this_thread::get_id();
    auto probe = std::shared_ptr<Probe>(new Probe{&releasedOn});
    ext::Callback<Fn<bool(BigInt)>> keep("Filter.setKeep's keep", ext::Lives::Copies,
                                         Fn<bool(BigInt)>([probe](BigInt at) { return at.toString().toUtf8() != "0"; }));
    keepIt = keep.function();
    keep.done();
    probe.reset();

    // A later call: at once, with its result.
    CHECK(ext::cxxCall("Filter.apply", [&] { return keepIt(3) && !keepIt(0); }));

    // A parameter of any std::function its arguments convert to, by const reference too.
    std::string named;
    ext::Callback<Fn<void(String, double)>> name("Filter.each's visit", ext::Lives::Copies,
                                                 Fn<void(String, double)>([&](String s, double n) {
                                                   named += s.toUtf8() + std::to_string(int(n));
                                                 }));
    auto each = [](const std::function<void(const std::string&, int)>& visit) {
      visit("a", 1);
      visit(std::string("b"), 2);
    };
    ext::cxxCall("Filter.each", [&] { each(name.function()); });
    name.done();
    CHECK(named == "a1b2");
  });

  // From another thread, after the call: refused, reported, zero.
  bool got = true;
  std::thread([&] { got = keepIt(3); }).join();
  CHECK(!got);

  std::thread([&] { keepIt = nullptr; }).join();
  CHECK(within([&] { return releasedOn.load() == contextThread; }));
  context->shutdown();
}

/// The function generated code gives C is of C's own parameter type,
/// wherever its `void *` is; what a callback threw can wait for the caller.
static void thunks() {
  auto context = IsolatedContext::create();
  Seen seen;

  std::string error = inside(*context, [&] {
    ext::Callback<Fn<void(double)>> each("visit_each's visit", ext::Lives::Call,
                                         Fn<void(double)>([&](double v) { seen.add(std::to_string(int(v))); }));
    const double values[] = {7, 8};
    Visit visit = ext::thunk<Fn<void(double)>, 1>(ext::paramOf<2>(&visitEach));
    ext::call([&] { visitEach(values, 2, visit, each.context()); });
    each.done();

    ext::Callback<Fn<bool(String, BigInt)>> keep(
        "count_kept's keep", ext::Lives::Call, Fn<bool(String, BigInt)>([&](String name, BigInt) -> bool {
          if (name.toUtf8() == "a") throwError(makeError(String::fromUtf8("not a")));
          return true;
        }));
    Keep kept = ext::thunk<Fn<bool(String, BigInt)>, 0>(ext::paramOf<0>(&countKept));
    std::exception_ptr thrown;
    int n = ext::call(thrown, [&] { return countKept(kept, keep.context()); });
    CHECK(n == 2);
    CHECK(thrown != nullptr);
    seen.add("released");
    return ::thrown([&] { ext::rethrow(thrown); });
  });

  CHECK(seen.text() == "7 8 released");
  CHECK(error == "Error: not a");
  context->shutdown();
}

// --- signals (decision 0129) -------------------------------------------------

/// A C function that polls its flag, as a cancellable one does: how many
/// steps it took before the flag turned true. It reads the flag with an
/// atomic load, as C should where its compiler has one (a plain volatile
/// read races with abort() as the memory model counts it).
static int pollSteps(const volatile bool* stop, int most, std::atomic<int>* step) {
  for (int i = 0; i < most; i++) {
    if (__atomic_load_n(stop, __ATOMIC_ACQUIRE)) return i;
    step->store(i + 1);
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return most;
}

/// The flag turns true as soon as the signal aborts on another thread,
/// while the call holds the signal's context; the call then throws the
/// reason. One aborted before the call makes none; none gives a false flag.
static void signalFlags() {
  auto context = IsolatedContext::create();

  std::string none = inside(*context, [&] {
    return thrown([&] {
      ext::SignalFlag flag{Opt<AbortSignal>()};
      CHECK(*flag.c() == false);
      CHECK(!flag.cxx().load());
      flag.done();
    });
  });
  CHECK(none.empty());

  int steps = -1;
  std::string stopped = inside(*context, [&] {
    auto controller = std::make_shared<AbortControllerObject>();
    Opt<AbortSignal> signal(controller->signal);
    std::atomic<int> step{0};
    return thrown([&] {
      ext::SignalFlag flag{signal};
      std::thread aborter([&] {
        while (step.load() < 3) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        controller->abort(Opt<Error>(makeError(String::fromUtf8("TimeoutError"), String::fromUtf8("too slow"))));
      });
      steps = ext::call([&] { return pollSteps(flag.c(), 2000, &step); });
      aborter.join();
      // The abort hasn't reached the signal's context, which this call holds.
      CHECK(!controller->signal->aborted.load());
      flag.done();
    });
  });
  CHECK(steps >= 3 && steps < 2000);
  CHECK(stopped == "TimeoutError: too slow");

  std::string before = inside(*context, [&] {
    auto controller = std::make_shared<AbortControllerObject>();
    controller->abort(Opt<Error>());
    Opt<AbortSignal> signal(controller->signal);
    bool called = false;
    std::string error = thrown([&] {
      ext::SignalFlag flag{signal};
      called = true;
    });
    CHECK(!called);
    return error;
  });
  CHECK(before == "AbortError: signal is aborted without reason");

  // C++: the reason comes instead of what the call threw.
  std::string cxx = inside(*context, [&] {
    auto controller = std::make_shared<AbortControllerObject>();
    Opt<AbortSignal> signal(controller->signal);
    return thrown([&] {
      ext::SignalFlag flag{signal};
      ext::cxxCall("Job.run", flag, [&] {
        controller->abort(Opt<Error>());
        if (flag.cxx().load()) throw std::runtime_error("stopped");
      });
    });
  });
  CHECK(cxx == "AbortError: signal is aborted without reason");
  context->shutdown();
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
  cxxExceptions();
  cxxValues();
  cxxObjects();
  callbacksRunAtOnce();
  throwsAfterTheCall();
  postedFromAnotherThread();
  lifetimes();
  cxxFunctions();
  thunks();
  signalFlags();

  std::printf("extension: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
